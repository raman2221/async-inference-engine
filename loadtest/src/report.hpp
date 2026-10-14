#pragma once

#include <string>

#include "completions.hpp"
#include "ingress.hpp"
#include "options.hpp"

struct RunResult {
  Options options;
  IngressReport ingress;
  CompletionReport completions;
};

void print_ingress(const IngressReport& report);

void print_completions(const CompletionReport& report);

/** Flat JSON consumed by scripts/compare.py; keep the key names in sync with it. */
std::string to_json(const RunResult& result);

/** Throws std::runtime_error if the file cannot be written. */
void write_json_file(const std::string& path, const RunResult& result);
