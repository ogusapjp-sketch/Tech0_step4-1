"""pytest-cov が出力した coverage.json で、Statements と Branch の網羅率がそれぞれ基準以上かを確認する。

test_spec.md 2.5 の合否基準は「Statements・Branch ともに 80% 以上」。coverage.py の fail_under は
行と分岐を合算した値でしか判定できないため、別々に計算して確認する。

使い方：python check_python_coverage.py coverage.json 80
"""

import json
import sys


def percent(covered: int, total: int) -> float:
    return 100.0 if total == 0 else 100.0 * covered / total


def main(path: str, threshold: float) -> int:
    with open(path, encoding="utf-8") as file:
        totals = json.load(file)["totals"]
    statements = percent(totals["covered_lines"], totals["num_statements"])
    branches = percent(totals["covered_branches"], totals["num_branches"])
    print(f"Statements {statements:.2f}% / Branch {branches:.2f}%（基準 {threshold:g}% 以上）")
    if statements < threshold or branches < threshold:
        print("カバレッジが基準を下回っています", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], float(sys.argv[2])))
