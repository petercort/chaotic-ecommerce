# Architecture Documentation

This document explains the architecture of the e-commerce application, both in its current monolithic state and the target microservices architecture.

---

## Current Monolithic Architecture

### System Overview

```
┌────────────────────────────────────────────────────────┐
│                  E-Commerce Monolith                   │
│                   (Port 8080)                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Customer   │  │  Inventory   │  │    Order     │  │
│  │   Domain     │  │   Domain     │  │   Domain     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                 │                  │         │
│         └─────────────────┴──────────────────┘         │
│                          │                             │
│                   ┌──────▼───────┐                     │
│                   │  H2 Database │                     │
│                   │  (In-Memory) │                     │
│                   └──────────────┘                     │
└────────────────────────────────────────────────────────┘
```

### Layer Architecture

```
┌────────────────────────────────────────┐
│         REST Controllers               │
│  CustomerController | ProductController│
│       OrderController                  │
├────────────────────────────────────────┤
│           Service Layer                │
│   CustomerService | ProductService     │
│        OrderService ← (depends on      │
│        CustomerService & ProductService)│
├────────────────────────────────────────┤
│        Repository Layer                │
│  CustomerRepository | ProductRepository│
│       OrderRepository                  │
├────────────────────────────────────────┤
│         JPA Entities                   │
│    Customer | Product | Order          │
│           OrderItem                    │
├────────────────────────────────────────┤
│         H2 Database                    │
│   Tables: customers, products,         │
│     orders, order_items                │
└────────────────────────────────────────┘
```

### Domain Dependencies

```
┌──────────────┐
│    Order     │
│   Service    │
└──────┬───────┘
       │ depends on
       ├──────────────┐
       │              │
       ▼              ▼
┌──────────────┐  ┌──────────────┐
│   Customer   │  │  Inventory   │
│   Service    │  │   Service    │
└──────────────┘  └──────────────┘
```

**Problem**: Tight coupling - OrderService directly calls methods on CustomerService and ProductService.

---

## Target Microservices Architecture

### System Overview

```
                    ┌─────────────┐
                    │   Client    │
                    │ Application │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Customer   │ │  Inventory  │ │    Order    │
    │  Service    │ │  Service    │ │  Service    │
    │ (Port 8081) │ │ (Port 8082) │ │ (Port 8083) │
    ├─────────────┤ ├─────────────┤ ├─────────────┤
    │   REST API  │ │   REST API  │ │   REST API  │
    ├─────────────┤ ├─────────────┤ ├─────────────┤
    │  Service    │ │  Service    │ │  Service    │
    │   Layer     │ │   Layer     │ │   Layer     │
    ├─────────────┤ ├─────────────┤ ├─────────────┤
    │ Repository  │ │ Repository  │ │ Repository  │
    ├─────────────┤ ├─────────────┤ ├─────────────┤
    │ Customer DB │ │ Product DB  │ │  Order DB   │
    │ (Postgres)  │ │  (SQLite)   │ │  (SQLite)   │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### Service Communication

```
                    ┌─────────────┐
                    │    Order    │
                    │   Service   │
                    └──────┬──────┘
                           │
            ┌──────────────┴──────────────┐
            │ REST Calls (HTTP)           │
            │                             │
            ▼                             ▼
    ┌───────────────┐           ┌───────────────┐
    │CustomerClient │           │InventoryClient│
    │               │           │               │
    │ GET /api/     │           │ GET /api/     │
    │ customers/{id}│           │ products/{id} │
    │               │           │               │
    │               │           │ POST /api/    │
    │               │           │ products/{id}/│
    │               │           │ reserve       │
    └───────┬───────┘           └───────┬───────┘
            │                           │
            ▼                           ▼
    ┌─────────────┐           ┌─────────────┐
    │  Customer   │           │  Inventory  │
    │  Service    │           │  Service    │
    │ (Port 8081) │           │ (Port 8082) │
    └─────────────┘           └─────────────┘
```

### Data Ownership

Each service owns its own data:

```
Customer Service      Inventory Service      Order Service
┌──────────────┐     ┌──────────────┐      ┌──────────────┐
│ Customer DB  │     │ Product DB   │      │  Order DB    │
│ (PostgreSQL) │     │  (SQLite)    │      │  (SQLite)    │
├──────────────┤     ├──────────────┤      ├──────────────┤
│ customers    │     │ products     │      │ orders       │
│              │     │              │      │ order_items  │
└──────────────┘     └──────────────┘      └──────────────┘

Note: No foreign keys across services!
Order.customerId is just an ID reference,
not a database foreign key.

customer-service persists to a PostgreSQL container with a named
volume, so its data survives restarts. inventory-service and
order-service still use in-memory SQLite (reset on restart).
```

---

## Domain Models

### Customer Domain

**Entity**: Customer
```
Customer
├── id: Long (PK)
├── firstName: String
├── lastName: String
├── email: String (unique)
├── phone: String
├── address: String
├── city: String
├── state: String
├── zipCode: String
├── country: String
├── createdAt: LocalDateTime
└── updatedAt: LocalDateTime
```

**Responsibilities**:
- Manage customer data
- Validate customer information
- Provide customer lookup by ID or email

**API Endpoints**:
- `GET /api/customers` - List all customers
- `GET /api/customers/{id}` - Get customer by ID
- `GET /api/customers/email/{email}` - Get customer by email
- `POST /api/customers` - Create customer
- `PUT /api/customers/{id}` - Update customer
- `DELETE /api/customers/{id}` - Delete customer

---

### Inventory Domain

**Entity**: Product
```
Product
├── id: Long (PK)
├── name: String
├── description: String
├── sku: String (unique)
├── price: BigDecimal
├── stockQuantity: Integer
├── category: String
├── reorderLevel: Integer
├── active: Boolean
├── createdAt: LocalDateTime
└── updatedAt: LocalDateTime
```

**Responsibilities**:
- Manage product catalog
- Track inventory levels
- Handle stock reservations and restores
- Alert on low stock

**API Endpoints**:
- `GET /api/products` - List all products
- `GET /api/products/{id}` - Get product by ID
- `GET /api/products/sku/{sku}` - Get product by SKU
- `GET /api/products/category/{category}` - List by category
- `GET /api/products/low-stock?threshold=10` - Get low stock items
- `POST /api/products` - Create product
- `PUT /api/products/{id}` - Update product
- `POST /api/products/{id}/reserve?quantity=X` - Reserve stock
- `POST /api/products/{id}/restore?quantity=X` - Restore stock
- `DELETE /api/products/{id}` - Delete product

---

### Order Domain

**Entities**: Order, OrderItem
```
Order
├── id: Long (PK)
├── customerId: Long (reference)
├── orderNumber: String (unique)
├── status: OrderStatus enum
├── items: List<OrderItem>
├── totalAmount: BigDecimal
├── shippingAddress: String
├── shippingCity: String
├── shippingState: String
├── shippingZip: String
├── shippingCountry: String
├── createdAt: LocalDateTime
└── updatedAt: LocalDateTime

OrderItem
├── id: Long (PK)
├── order: Order (FK)
├── productId: Long (reference)
├── productName: String
├── productSku: String
├── quantity: Integer
├── unitPrice: BigDecimal
└── subtotal: BigDecimal
```

**Responsibilities**:
- Process customer orders
- Coordinate with Customer and Inventory services
- Calculate order totals
- Manage order lifecycle

**API Endpoints**:
- `GET /api/orders` - List all orders
- `GET /api/orders/{id}` - Get order by ID
- `GET /api/orders/order-number/{number}` - Get by order number
- `GET /api/orders/customer/{customerId}` - List customer orders
- `GET /api/orders/status/{status}` - List by status
- `POST /api/orders` - Create order
- `PATCH /api/orders/{id}/status?status=X` - Update status
- `DELETE /api/orders/{id}` - Delete order

---

## Key Design Patterns

### DTO Pattern
Separate request/response objects from entities:
```
CreateOrderRequest → OrderService → Order entity
Order entity → OrderResponse → Client
```

### Client Pattern (for microservices)
Services communicate via REST (axios) clients to other services' HTTP APIs.

---

## Microservices Design Considerations

### Data Consistency

**Monolith**:
- Single database transaction
- ACID guarantees
- Immediate consistency

**Microservices**:
- Distributed transactions
- Eventual consistency
- Saga pattern for complex workflows

### Example: Order Creation Flow

**Monolith** (Current):
```
1. Begin transaction
2. Validate customer (direct method call)
3. Validate product (direct method call)
4. Reserve stock (direct method call)
5. Create order (direct method call)
6. Commit transaction
```

**Microservices** (Target):
```
1. Order Service: Receive request
2. Order Service → Customer Service: GET /api/customers/{id}
3. Customer Service: Return customer data
4. Order Service → Inventory Service: GET /api/products/{id}
5. Inventory Service: Return product data
6. Order Service → Inventory Service: POST /api/products/{id}/reserve
7. Inventory Service: Reserve stock, return success
8. Order Service: Create order in its database
9. Return order to client

If step 7 fails: No compensation needed (no order created yet)
If step 8 fails: Need to restore stock (compensation logic)
```

### Error Handling

**Challenges in Microservices**:
- Network failures
- Service unavailability
- Partial failures (some calls succeed, others fail)

**Solutions**:
- Retry logic with exponential backoff
- Circuit breakers (opossum)
- Timeouts and fallbacks
- Idempotency (safe to retry)

### Performance Considerations

**Latency**:
- Monolith: Method calls are nanoseconds
- Microservices: HTTP calls are milliseconds

**Mitigation**:
- Caching frequently accessed data
- Async communication where possible
- Optimize API calls (batch requests)

---

## Deployment Architecture

### Monolith Deployment

```
┌─────────────────────────┐
│   Application Server    │
│   (Single JAR/WAR)      │
│                         │
│  ┌───────────────────┐  │
│  │  ecommerce.jar    │  │
│  │  All domains      │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │   Database        │  │
│  └───────────────────┘  │
└─────────────────────────┘

Scale: Replicate entire application
```

### Microservices Deployment

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Container 1  │  │ Container 2  │  │ Container 3  │
│              │  │              │  │              │
│ customer-    │  │ inventory-   │  │ order-       │
│ service.jar  │  │ service.jar  │  │ service.jar  │
│              │  │              │  │              │
│ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │
│ │Customer  │ │  │ │Product   │ │  │ │Order     │ │
│ │DB        │ │  │ │DB        │ │  │ │DB        │ │
│ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │
└──────────────┘  └──────────────┘  └──────────────┘

Scale: Replicate individual services as needed
```

---

## Migration Strategy

### Phase 1: Extract Customer Service
- Independent service
- Own database
- No dependencies on other services
- Low risk

### Phase 2: Extract Inventory Service
- Independent service
- Own database
- No dependencies on other services
- Low risk

### Phase 3: Extract Order Service
- Depends on Customer and Inventory services
- Implement REST clients
- Handle distributed transactions
- Medium risk

### Phase 4: Enhanced Microservices
- Add API Gateway
- Add Service Discovery
- Add Circuit Breakers
- Add Distributed Tracing

---

## Technology Stack

### Current (Microservices — TypeScript/Node.js)
- **Language**: TypeScript 5, Node.js 20
- **Framework**: Express.js
- **Database**: PostgreSQL (customer-service, durable via named volume); better-sqlite3 in-memory (inventory-service, order-service)
- **DB driver**: pg (node-postgres) with connection pool + retry/backoff
- **Validation**: zod
- **HTTP client**: axios (order-service → customer/inventory)
- **Circuit breaker**: opossum
- **Build**: tsc (services), esbuild (k6 load tests)
- **API**: REST (Express)

### Key Design Patterns (TypeScript)

#### 1. Route Handler Pattern
Each service has route handlers. customer-service uses async `pg` pool queries:
```typescript
router.get('/api/customers', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM customers ORDER BY id');
  res.json(rows.map(rowToCustomer));
});
```

#### 2. Database Layer
customer-service connects to PostgreSQL with retry/backoff and runs an
idempotent migration on startup (inventory-service and order-service still
use in-memory SQLite):
```typescript
const pool = new Pool({ host: process.env.DB_HOST, /* ... */ });
await connectWithRetry();
await runMigrations();   // CREATE TABLE IF NOT EXISTS customers (...)
await seedDefaultCustomers();
```

#### 3. Saga Orchestration (order-service)
Order creation coordinates across services with compensation:
```typescript
// Reserve stock for each item
for (const item of items) {
  const ok = await reserveStock(item.productId, item.quantity);
  if (!ok) {
    // Compensate: restore already-reserved stock
    for (const reserved of reservedItems) {
      await restoreStock(reserved.productId, reserved.quantity);
    }
    throw new Error('Insufficient stock');
  }
  reservedItems.push(item);
}
```

#### 4. Circuit Breaker Pattern (opossum)
Individual circuit breakers protect each downstream call:
```typescript
const getCustomerBreaker = new CircuitBreaker(
  (id: number) => axios.get(`${CUSTOMER_SERVICE_URL}/api/customers/${id}`),
  { timeout: 5000, errorThresholdPercentage: 50 }
);
```

#### 5. Zod Validation
Request bodies validated with zod schemas:
```typescript
const CreateOrderSchema = z.object({
  customerId: z.number(),
  items: z.array(z.object({ productId: z.number(), quantity: z.number().min(1) })).min(1),
});
```
