# Authored and lock config split

Ralph separates human-authored repo config in `.pi/executor.yaml` from generated resolved provider identity in `.pi/executor.lock.yaml`, and both files are committed to git. `setup` resolves names to IDs into the lock file, while normal execution refuses authored/resolved drift so runs stay deterministic and reviewable.