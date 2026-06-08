#!/usr/bin/env bash
# run-all-chaos.sh — Execute all chaos scenarios sequentially and report results
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$REPO_ROOT/results"
mkdir -p "$RESULTS_DIR"

# ── ANSI colours ─────────────────────────────────────────────────────────────
GREEN=$'\033[0;32m'
RED=$'\033[0;31m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# ── Scenario list (s1 → s6, s8) ───────────────────────────────────────────────
SCENARIOS=(
    "$SCRIPT_DIR/s1-eureka-kill.sh"
    "$SCRIPT_DIR/s2-customer-service-kill.sh"
    "$SCRIPT_DIR/s3-inventory-latency.sh"
    "$SCRIPT_DIR/s4-gateway-overload.sh"
    "$SCRIPT_DIR/s5-cascade-failure.sh"
    "$SCRIPT_DIR/s6-network-partition.sh"
    "$SCRIPT_DIR/s8-network-packet-drop.sh"
)

# ── Result arrays (populated as scenarios run) ────────────────────────────────
declare -a NAMES=()
declare -a RESULTS=()
declare -a DURATIONS=()

SUITE_START=$SECONDS
ANY_FAILED=false

# ── Print summary table — called from trap and at end ─────────────────────────
print_summary() {
    local total=${#NAMES[@]}
    local passed=0 failed=0

    for r in "${RESULTS[@]}"; do
        [ "$r" = "PASS" ] && ((passed++)) || ((failed++))
    done

    local suite_elapsed=$(( SECONDS - SUITE_START ))
    local suite_min=$(( suite_elapsed / 60 ))
    local suite_sec=$(( suite_elapsed % 60 ))
    local duration_str
    if [ "$suite_min" -gt 0 ]; then
        duration_str="${suite_min}m ${suite_sec}s"
    else
        duration_str="${suite_sec}s"
    fi

    echo ""
    echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${RESET}"
    echo -e "${BOLD}${CYAN}║            CHAOS TEST SUITE SUMMARY                      ║${RESET}"
    echo -e "${BOLD}${CYAN}╠══════════════════════════════════════════════════════════╣${RESET}"
    echo -e "${BOLD}${CYAN}║  #  Scenario                    Result   Duration        ║${RESET}"
    echo -e "${BOLD}${CYAN}╠══════════════════════════════════════════════════════════╣${RESET}"

    for i in "${!NAMES[@]}"; do
        local num=$(( i + 1 ))
        local name="${NAMES[$i]}"
        local result="${RESULTS[$i]}"
        local dur="${DURATIONS[$i]}"

        # Truncate/pad name to 28 chars
        local name_padded
        name_padded="$(printf '%-28s' "${name:0:28}")"

        # Pad duration to 6 chars
        local dur_padded
        dur_padded="$(printf '%-6s' "$dur")"

        if [ "$result" = "PASS" ]; then
            local result_colored="${GREEN}${BOLD}PASS${RESET}"
            local result_pad="    "   # 4 chars = width of "PASS"
        else
            local result_colored="${RED}${BOLD}FAIL${RESET}"
            local result_pad="    "   # 4 chars = width of "FAIL"
        fi

        # Build row: use plain printf for fixed columns, raw echo for colour codes
        printf "${CYAN}║${RESET}  %-2s %-28s " "$num" "${name:0:28}"
        printf "%s%s" "$result_colored" "  "
        printf "%-12s${CYAN}║${RESET}\n" "$dur"
    done

    echo -e "${BOLD}${CYAN}╠══════════════════════════════════════════════════════════╣${RESET}"

    local footer="Total: $total | Passed: $passed | Failed: $failed | Duration: $duration_str"
    printf "${BOLD}${CYAN}║${RESET}  %-56s${BOLD}${CYAN}║${RESET}\n" "$footer"
    echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${RESET}"
    echo ""
}

# Print summary even on unexpected exit (Ctrl-C, etc.)
trap print_summary EXIT

# ── Run each scenario ─────────────────────────────────────────────────────────
for scenario_path in "${SCENARIOS[@]}"; do
    scenario_name="$(basename "$scenario_path" .sh)"
    log_file="$RESULTS_DIR/chaos-${scenario_name}.log"

    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}▶  Running: ${CYAN}${scenario_name}${RESET}"
    echo -e "${BOLD}   Log    : ${log_file}${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"

    scenario_start=$SECONDS

    # Run scenario; capture exit code without aborting this script
    set +e
    bash "$scenario_path" 2>&1 | tee "$log_file"
    exit_code=${PIPESTATUS[0]}
    set -e

    scenario_dur=$(( SECONDS - scenario_start ))

    NAMES+=("$scenario_name")
    DURATIONS+=("${scenario_dur}s")

    if [ "$exit_code" -eq 0 ]; then
        RESULTS+=("PASS")
        echo -e "\n${GREEN}${BOLD}✔  ${scenario_name} PASSED${RESET} (${scenario_dur}s)"
    else
        RESULTS+=("FAIL")
        ANY_FAILED=true
        echo -e "\n${RED}${BOLD}✘  ${scenario_name} FAILED${RESET} (exit ${exit_code}, ${scenario_dur}s) — see ${log_file}"
    fi

    # Allow services 60 s to fully recover (re-register with Eureka, warm up)
    # before the next scenario's steady-state pre-check runs.
    echo -e "${CYAN}[inter-scenario] Waiting 60s for services to recover before next scenario...${RESET}"
    sleep 60
done

# ── Summary is printed by the trap; set exit code ─────────────────────────────
# Remove trap so it doesn't double-print (we call print_summary explicitly below
# only to get the exit code right — trap fires on exit anyway)
trap - EXIT
print_summary

if [ "$ANY_FAILED" = "true" ]; then
    exit 1
else
    exit 0
fi
