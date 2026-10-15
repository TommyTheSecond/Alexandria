"""Run untrusted-file parsing in a child process with a time limit and (on Linux) a memory limit."""

from __future__ import annotations

import multiprocessing as mp
from typing import Any, Callable

MEMORY_LIMIT_BYTES = 1 << 30  # 1 GB (README section 13)


class SandboxError(RuntimeError):
    """The child failed: crashed, raised, or was killed."""


class SandboxTimeout(SandboxError):
    """The child did not answer within the time limit and was killed."""


def _child(conn, fn: Callable[..., Any], args: tuple) -> None:
    try:
        try:
            import resource  # Linux/macOS only; WSL2 and Docker have it
            resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
        except (ImportError, ValueError, OSError):
            pass
        conn.send(("ok", fn(*args)))
    except BaseException as exc:  # report every failure to the parent
        conn.send(("error", f"{type(exc).__name__}: {exc}"[:300]))
    finally:
        conn.close()


def run(fn: Callable[..., Any], *args: Any, timeout: float = 60) -> Any:
    """Call fn(*args) in a fresh process. fn and its result must be picklable."""
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, fn, args), daemon=True)
    proc.start()
    child.close()
    try:
        if not parent.poll(timeout):
            raise SandboxTimeout(f"timed out after {timeout:g} s")
        status, value = parent.recv()
    except EOFError:
        raise SandboxError(f"parser process died (exit code {proc.exitcode})") from None
    finally:
        if proc.is_alive():
            proc.kill()
        proc.join(5)
        parent.close()
    if status != "ok":
        raise SandboxError(value)
    return value
