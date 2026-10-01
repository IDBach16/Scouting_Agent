"""Where awre_data.csv lives.

Desktop (AWRE_DATA_DIR unset): next to this repo, so update_awre.bat keeps
writing the file it always has.

Railway: set AWRE_DATA_DIR to the volume mount (for example /data). The CSV
name stays awre_data.csv. On boot, if that file is missing, copy the baked-in
repo CSV once so the app can serve before the first overnight pull.
"""

import os
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_NAME = "awre_data.csv"
REPO_CSV = os.path.join(SCRIPT_DIR, CSV_NAME)


def data_dir():
    """Directory that holds awre_data.csv. Repo dir when AWRE_DATA_DIR is unset."""
    override = os.environ.get("AWRE_DATA_DIR", "").strip()
    if override:
        return os.path.abspath(override)
    return SCRIPT_DIR


def csv_path():
    return os.path.join(data_dir(), CSV_NAME)


def file_signature(path):
    """(mtime_ns, size) or None when the file is missing.

    Both workers compare this on read so a pull written by one process is
    visible to the other without a restart. Size is included because some
    filesystems stamp mtime in whole seconds.
    """
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def seed_if_missing():
    """Copy the baked-in repo CSV into AWRE_DATA_DIR once, if that file is absent.

    No-op when AWRE_DATA_DIR is unset, when the destination already exists,
    or when there is no baked-in file to copy. Two gunicorn workers can race
    at boot; the loser leaves the winner's file alone.
    Returns True only when this process wrote the seed.
    """
    override = os.environ.get("AWRE_DATA_DIR", "").strip()
    if not override:
        return False
    dest = csv_path()
    if os.path.exists(dest):
        return False
    if not os.path.isfile(REPO_CSV):
        print(f"AWRE seed skipped: {dest} is missing and {REPO_CSV} is not in the image")
        return False
    if os.path.abspath(dest) == os.path.abspath(REPO_CSV):
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # Unique per attempt. A shared name would let overlapping seeds unlink
    # each other's temp file (gunicorn workers are separate processes, but
    # a same-process race should still be safe).
    tmp = f"{dest}.{os.getpid()}.{os.urandom(4).hex()}.seedtmp"
    placed = False
    try:
        shutil.copy2(REPO_CSV, tmp)
        placed = _place_no_clobber(tmp, dest)
    except OSError as e:
        print(f"AWRE seed failed ({dest}): {e}")
        return False
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    if placed:
        print(f"Seeded AWRE CSV: {dest}")
    return placed


def _place_no_clobber(tmp, dest):
    """Put tmp's bytes at dest only when dest does not already exist."""
    try:
        os.link(tmp, dest)
        return True
    except FileExistsError:
        return False
    except OSError:
        # Volumes that reject hardlinks still must not clobber a file another
        # worker just seeded (or a pull that landed during boot).
        try:
            fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            return False
        try:
            with os.fdopen(fd, "wb") as out, open(tmp, "rb") as inp:
                shutil.copyfileobj(inp, out)
        except Exception:
            # Don't leave a truncated dest that later seeds will treat as present.
            try:
                os.remove(dest)
            except OSError:
                pass
            raise
        return True
