# QNBS-v3: subdirectory CMakeLists.txt reusing CEF's own proven CMake macros rather than reinventing its platform bootstrap (ADR-0020, Option B).
#
# This file is a SUBDIRECTORY CMakeLists.txt, added via add_subdirectory() from
# a *copy* of CEF's own root CMakeLists.txt at build time (see
# .github/workflows/cef-learning-harness.yml and scripts/cef/prepare-cef-build.mjs)
# — never invoked directly with `cmake -S apps/desktop-cef`. This mirrors the
# ADR-0020 spike's proven mechanism exactly, rather than reinventing CEF's own
# platform bootstrap (compiler/linker flags, OS_LINUX detection, PROJECT_ARCH)
# from scratch: it relies on CEF_STANDARD_LIBS, CEF_LIB_DEBUG/CEF_LIB_RELEASE,
# CEF_BINARY_FILES, CEF_RESOURCE_FILES, CEF_BINARY_DIR, CEF_RESOURCE_DIR, and the
# ADD_LOGICAL_TARGET/COPY_FILES/SET_EXECUTABLE_TARGET_PROPERTIES/FIND_LINUX_LIBRARIES
# macros already being defined by that parent scope by the time this runs — exactly
# what CEF's own bundled sample targets (cefsimple, cefclient) rely on too.

# QNBS-v3: fetched via CMake FetchContent (small, MIT-licensed CMake module, not a binary) rather than vendored — replaces the ADR-0020 spike's hardcoded .a path with real Cargo<->CMake integration.
include(FetchContent)
FetchContent_Declare(
  Corrosion
  GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
  GIT_TAG v0.5.1
)
FetchContent_MakeAvailable(Corrosion)

corrosion_import_crate(MANIFEST_PATH "${CMAKE_CURRENT_SOURCE_DIR}/rust-core/Cargo.toml")

set(WORLDSCRIPT_HOST_SRCS
  src/main.cpp
  src/shutdown_signal.h
  src/shutdown_signal.cpp
  src/worldscript_app.h
  src/worldscript_app.cpp
  src/worldscript_handler.h
  src/worldscript_handler.cpp
)

add_executable(worldscript_host ${WORLDSCRIPT_HOST_SRCS})
add_dependencies(worldscript_host libcef_dll_wrapper)

ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")

target_link_libraries(worldscript_host
  libcef_lib
  libcef_dll_wrapper
  worldscript_rust_core
  ${CEF_STANDARD_LIBS}
)

set_target_properties(worldscript_host PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}"
)

SET_EXECUTABLE_TARGET_PROPERTIES(worldscript_host)

COPY_FILES("worldscript_host" "${CEF_BINARY_FILES}" "${CEF_BINARY_DIR}" "${CMAKE_CURRENT_BINARY_DIR}")
COPY_FILES("worldscript_host" "${CEF_RESOURCE_FILES}" "${CEF_RESOURCE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}")

if(OS_LINUX)
  FIND_LINUX_LIBRARIES("x11")
endif()
