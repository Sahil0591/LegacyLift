# LegacyLift Target Profiles

LegacyLift separates business-rule archaeology from target-language generation.
The first job is to recover what the legacy system means: rules, dependencies,
risk, ownership, audit obligations, and approval paths. Target-language
generation then uses that recovered context and the selected target profile.

Python is one target profile, not the product identity. The product is a
governed migration workbench with MVP support for several enterprise
destinations.

## Profile Catalog

`codegen_supported=true` means the backend has target-aware generation, a
language-aware static validator, and a CI smoke fixture for that profile. Test
files may be generated in the target framework, but test execution is still
disabled and marked as manual verification until sandbox runners exist.

| Profile ID | Display name | Status | Codegen supported | Static validation |
|---|---|---|---|---|
| `python-3x` | Python 3.x | active | true | `ast.parse` plus Python migration checks |
| `java-21` | Java 21 / 25 | active_experimental | true | `javac` syntax/compile check |
| `csharp-dotnet` | C# / .NET | active_experimental | true | `dotnet build` |
| `cpp-23` | C++23 | active_experimental | true | `g++` or `clang++ -std=c++23 -fsyntax-only` |
| `rust-2024` | Rust 2024 | active_experimental | true | `rustc --edition 2024` |
| `sql-plsql` | SQL / PL/SQL / T-SQL | active_experimental | true | `sqlparse` structural validation plus dialect warnings |
| `go-1x` | Go | active_experimental | true | `go test -c` |
| `typescript-5x` | TypeScript | active_experimental | true | `tsc --noEmit` |

## MVP Boundary

- Generation prompts are target-aware and include target profile guidance.
- Static checks are language-aware and fail honestly when a required local
  toolchain is unavailable.
- Static validators are single-file smoke checks. If validation is blocked only
  by unresolved third-party dependencies, LegacyLift records a warning and
  requires project-level build verification before approval.
- Test generation targets the correct framework (`pytest`, JUnit, xUnit,
  GoogleTest, cargo test, go test, vitest, tSQLt/utPLSQL).
- Generated tests are not executed by the backend yet; reviewers must manually
  verify them.
- Non-Python targets are intentionally marked `active_experimental`.

## Follow-Ups

- Add locked-down sandbox runners for target test execution.
- Expand pair-specific gotchas and deprecations for source-to-target
  combinations.
- Add richer validators where compiler-only checks miss semantic hazards.
