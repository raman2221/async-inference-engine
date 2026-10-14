cmake_minimum_required(VERSION 3.20)
project(loadtest CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# cpp-httplib is a single header; download it once into the build tree.
set(HTTPLIB_VERSION v0.20.0)
set(HTTPLIB_HEADER ${CMAKE_BINARY_DIR}/third_party/httplib.h)
if(NOT EXISTS ${HTTPLIB_HEADER})
  file(DOWNLOAD
    https://raw.githubusercontent.com/yhirose/cpp-httplib/${HTTPLIB_VERSION}/httplib.h
    ${HTTPLIB_HEADER} STATUS dl_status)
  list(GET dl_status 0 dl_code)
  if(NOT dl_code EQUAL 0)
    file(REMOVE ${HTTPLIB_HEADER})
    message(FATAL_ERROR "failed to download httplib.h: ${dl_status}")
  endif()
endif()

find_package(Threads REQUIRED)
add_executable(loadtest src/main.cpp)
target_include_directories(loadtest PRIVATE ${CMAKE_BINARY_DIR}/third_party)
target_link_libraries(loadtest PRIVATE Threads::Threads)
