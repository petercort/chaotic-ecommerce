import axios from 'axios';
import { getCustomer } from '../src/clients';

jest.mock('axios');

const mockAxios = axios as jest.Mocked<typeof axios>;

describe('order-service clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_JWT_SECRET = 'service-secret';
    process.env.JWT_SECRET = 'user-secret';
  });

  it('adds a bearer token to downstream customer requests', async () => {
    mockAxios.get.mockResolvedValue({
      data: { id: 1, firstName: 'Alice', lastName: 'Test', email: 'alice@example.com' },
      status: 200,
      headers: {},
      statusText: 'OK',
      config: {},
    } as never);

    await getCustomer(1);

    expect(mockAxios.get).toHaveBeenCalledTimes(1);
    const requestConfig = mockAxios.get.mock.calls[0][1];
    expect(requestConfig?.headers?.Authorization).toMatch(/^Bearer\s.+/);
  });
});