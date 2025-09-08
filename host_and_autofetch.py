import os
import sys
import posixpath
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, unquote
import urllib.request
import urllib.error


REMOTE_BASE = "https://588401306720027974.playables.usercontent.goog/v/assets"


def is_png_magic(data):
    return data.startswith(b"\x89PNG\r\n\x1a\n")


class AutoFetchHandler(SimpleHTTPRequestHandler):
    # Root directory to serve from; provided via server init
    def __init__(self, *args, **kwargs):
        super(AutoFetchHandler, self).__init__(*args, directory=kwargs.pop('directory'), **kwargs)

    def log_message(self, format, *args):
        # Keep default logging format (prints to stderr)
        super(AutoFetchHandler, self).log_message(format, *args)

    def send_head(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Use base class path translation
        local_path = self.translate_path(path)

        # Directory handling uses parent logic
        if os.path.isdir(local_path):
            return super(AutoFetchHandler, self).send_head()

        # If file already exists, serve normally
        if os.path.exists(local_path):
            return super(AutoFetchHandler, self).send_head()

        # If not found locally, try to auto-fetch PNGs under /assets/.../images/...
        norm = path.replace('\\', '/').lower()
        if norm.endswith('.png') and '/assets/' in norm and '/images/' in norm:
            # Build remote URL: REMOTE_BASE + original path
            # Ensure no traversal and percent-decode once
            rel_url_path = unquote(path)
            remote_url = REMOTE_BASE.rstrip('/') + rel_url_path

            # Compute safe local destination inside server root
            try:
                # Create directories if needed
                dest_dir = os.path.dirname(local_path)
                if dest_dir and not os.path.isdir(dest_dir):
                    os.makedirs(dest_dir)

                # Fetch
                req = urllib.request.Request(remote_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    data = resp.read()
                    ctype = resp.headers.get('Content-Type', '')

                # Validate PNG by magic to avoid junk
                if not is_png_magic(data):
                    self.log_message("Remote fetch is not valid PNG: %s (ctype=%s)", remote_url, ctype)
                else:
                    with open(local_path, 'wb') as f:
                        f.write(data)
                    self.log_message("Downloaded %d bytes -> %s", len(data), local_path)
            except urllib.error.HTTPError as e:
                self.log_message("Remote HTTPError %s for %s", e.code, remote_url)
            except Exception as e:
                self.log_message("Remote fetch failed for %s: %s", remote_url, e)

            # After attempting download, try serving again
            if os.path.exists(local_path):
                return super(AutoFetchHandler, self).send_head()

        # Fall back to default (will 404)
        return super(AutoFetchHandler, self).send_head()


def run(host='127.0.0.1', port=5500):
    # Serve from the current script directory
    root = os.path.dirname(os.path.abspath(__file__))
    handler_factory = lambda *args, **kwargs: AutoFetchHandler(*args, directory=root, **kwargs)
    httpd = ThreadingHTTPServer((host, port), handler_factory)
    print(f"Serving {root} at http://{host}:{port} (auto-fetching PNGs from {REMOTE_BASE})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        httpd.server_close()


if __name__ == '__main__':
    # Optional CLI: python host_and_autofetch.py [port]
    port = 5500
    if len(sys.argv) >= 2:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run(port=port)
