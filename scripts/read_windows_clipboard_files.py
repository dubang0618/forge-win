import ctypes
import json
import sys
from ctypes import wintypes

CF_HDROP = 15


def read_clipboard_files() -> list[str]:
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    shell32 = ctypes.WinDLL('shell32', use_last_error=True)

    open_clipboard = user32.OpenClipboard
    open_clipboard.argtypes = [wintypes.HWND]
    open_clipboard.restype = wintypes.BOOL

    close_clipboard = user32.CloseClipboard
    close_clipboard.argtypes = []
    close_clipboard.restype = wintypes.BOOL

    is_format_available = user32.IsClipboardFormatAvailable
    is_format_available.argtypes = [wintypes.UINT]
    is_format_available.restype = wintypes.BOOL

    get_clipboard_data = user32.GetClipboardData
    get_clipboard_data.argtypes = [wintypes.UINT]
    get_clipboard_data.restype = wintypes.HANDLE

    drag_query_file = shell32.DragQueryFileW
    drag_query_file.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
    drag_query_file.restype = wintypes.UINT

    if not open_clipboard(None):
        raise OSError('OpenClipboard failed')

    try:
        if not is_format_available(CF_HDROP):
            return []

        handle = get_clipboard_data(CF_HDROP)
        if not handle:
            raise OSError('GetClipboardData(CF_HDROP) failed')

        count = drag_query_file(handle, 0xFFFFFFFF, None, 0)
        paths: list[str] = []
        for index in range(count):
            length = drag_query_file(handle, index, None, 0)
            if length == 0:
                continue
            buffer = ctypes.create_unicode_buffer(length + 1)
            drag_query_file(handle, index, buffer, length + 1)
            value = buffer.value.strip()
            if value:
                paths.append(value)
        return paths
    finally:
        close_clipboard()


def main() -> int:
    try:
        paths = read_clipboard_files()
        # Force UTF-8 output with BOM to ensure proper encoding
        import codecs
        sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
        sys.stdout.write(json.dumps(paths, ensure_ascii=False))
        sys.stdout.flush()
        return 0
    except Exception as exc:
        sys.stderr.write(str(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
