import type { Context } from "hono";
import {
  NotesPlatformError,
  NotesScriptError,
} from "../notes/service.js";

export function handleNotesError(c: Context, err: unknown) {
  if (err instanceof NotesPlatformError) {
    return c.json(
      {
        error: "PlatformUnsupported",
        message: err.message,
      },
      501,
    );
  }
  if (err instanceof NotesScriptError) {
    const msg = err.message;
    if (/not found|Folder not found/i.test(msg)) {
      return c.json({ error: "NotFound", message: msg }, 404);
    }
    if (/not authorized|not allowed|access|permission|(-1743)/i.test(msg)) {
      return c.json(
        {
          error: "PermissionDenied",
          message:
            "macOS denied Automation access to Notes.app. Grant permission in System Settings → Privacy & Security → Automation.",
          detail: msg,
        },
        403,
      );
    }
    if (/locked|password/i.test(msg)) {
      return c.json(
        {
          error: "LockedNote",
          message: "Password-protected notes cannot be read or modified via AppleScript.",
          detail: msg,
        },
        403,
      );
    }
    return c.json({ error: "NotesError", message: msg }, 502);
  }
  console.error("[apple-notes-api] unexpected error", err);
  return c.json(
    {
      error: "InternalError",
      message: err instanceof Error ? err.message : "Unknown error",
    },
    500,
  );
}
