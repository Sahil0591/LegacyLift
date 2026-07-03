# LegacyLift Target Profiles

LegacyLift separates business-rule archaeology from target-language generation.
The first job is to recover what the legacy system means: rules, dependencies,
risk, ownership, audit obligations, and approval paths. Target-language
generation is a later governed step that should use that recovered context.

Python is one target profile, not the product identity. The product is not a
COBOL-to-Python converter; it is a governed migration workbench that can grow
profile-aware generation for multiple enterprise destinations.

## Profile Catalog

| Profile ID | Display name | Status | Codegen supported in PR1 | Intended use |
|---|---|---|---|---|
| `python-3x` | Python 3.x | active | false | Analytics workflows, internal tooling, and fast demo migration |
| `java-21` | Java 21 / 25 | stub | false | Core banking modernization, enterprise services, and payments platforms |
| `csharp-dotnet` | C# / .NET | stub | false | Microsoft-heavy enterprise workflows, line-of-business apps, and Azure-integrated services |
| `cpp-23` | C++23 | stub | false | Low-latency trading, pricing engines, and risk engines |
| `rust-2024` | Rust 2024 | stub | false | Safe high-performance modernization, systems services, and memory-safe data processing |
| `sql-plsql` | SQL / PL/SQL / T-SQL | stub | false | Stored procedures, reconciliation jobs, audit workflows, and settlement logic |

## What PR1 Adds

PR1 is registry/catalog only.

It adds backend Pydantic models and a Layer 0.5 registry that can list profiles,
look up a profile by canonical ID, and resolve a profile by ID or alias. All
profiles currently report `codegen_supported=false`, including Python, because
this PR does not wire generation, review, tests, API selection, or prompt
behavior to the catalog.

## Follow-Ups

- Layer 0.5 wiring so projects can carry a resolved target profile.
- API selector support so clients can choose from the profile catalog.
- Profile-aware migration prompts that use numeric, date, style, testing, and
  concurrency guidance from the selected profile.
- Pair-specific gotchas and deprecations for source-to-target combinations.
- Explicit enablement work before any profile can set `codegen_supported=true`.
