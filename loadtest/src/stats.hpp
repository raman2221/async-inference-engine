#pragma once

#include <algorithm>
#include <numeric>
#include <vector>

struct Distribution {
  double p50 = 0, p90 = 0, p99 = 0, max = 0, mean = 0;
};

/** Nearest-rank percentiles. Takes the vector by value because it sorts it. */
inline Distribution summarize(std::vector<double> values) {
  if (values.empty()) return {};
  std::sort(values.begin(), values.end());
  auto at = [&](double pct) {
    auto index = static_cast<size_t>(pct / 100.0 * static_cast<double>(values.size() - 1) + 0.5);
    return values[std::min(index, values.size() - 1)];
  };
  double mean = std::accumulate(values.begin(), values.end(), 0.0) / static_cast<double>(values.size());
  return {at(50), at(90), at(99), values.back(), mean};
}
