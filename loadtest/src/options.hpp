#pragma once

#include <string>

struct Options {
  std::string url = "http://localhost:8080";
  double rps = 500;
  int duration_s = 10;
  int threads = 32;
  int collect = 1000;  // accepted jobs to follow to completion; 0 skips the collect phase
  int collect_timeout_s = 180;
  std::string out;  // optional path for the JSON summary
};

/** Throws std::invalid_argument naming the bad flag or value. */
Options parse_args(int argc, char** argv);

bool wants_help(int argc, char** argv);

void print_usage();
