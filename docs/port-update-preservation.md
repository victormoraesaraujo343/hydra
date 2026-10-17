# Preserving user data during port updates

Release directories are replaced during updates. Ports that store saves or
settings beside their executable must declare those paths to preserve them.

Each OS asset can include an optional `preservePaths` array:

```json
{
  "pattern": "^Bloodborne-Windows\\.zip$",
  "executable": "Bloodborne.exe",
  "preservePaths": ["user", "bbport.ini", "input.ini"]
}
```

Paths are relative to the executable's parent directory, not the archive root.
This supports packages whose wrapper directory changes between releases.
Existing user files overwrite packaged defaults at declared paths; other package
files remain untouched. Missing optional files are skipped. Linked files or
directories, traversal, absolute paths and paths covering the executable fail
the update without deleting the previous installation.

For older catalogues without this field, `Supermedo/bloodborne_pc` uses the three
paths above. Other repositories retain their existing behavior unless they
declare preservation paths. An explicit empty array disables preservation.
Review declarations against each port's actual data layout; do not include
executables, libraries, game dumps or entire installation directories.

Data is copied into staging before the new release is committed. Same-release
reinstalls temporarily rename the existing target to a unique backup. The old
installation is removed only after library and installation records are saved.
Failures attempt to restore the previous files and metadata. If metadata
restoration also fails, recoverable installation files are retained rather than
deleted. This handles reported operation failures; it is not a crash-recovery
journal or a replacement for independent backups.

Close the port before updating. Copying does not provide a consistent snapshot
of a running game's writes. Uninstallation behavior is unchanged.

Regression coverage uses disposable files and simulated packages. It checks
data preservation, package defaults, same-release reinstalls, rollback failures
and source/destination junction rejection. No real game files are needed.
