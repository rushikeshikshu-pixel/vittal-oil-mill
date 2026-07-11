import http.server
import json
import os
import sys
import webbrowser
import threading
import time
import glob
import shutil
from datetime import datetime

PORT = 4567
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "database.json")
CONFIG_FILE = os.path.join(BASE_DIR, "firebase-config.json")
KEY_FILE = os.path.join(BASE_DIR, "firebase-service-key.json")

# --- Automated backups ---
BACKUP_DIR = os.path.join(BASE_DIR, "backups")
RECENT_DIR = os.path.join(BACKUP_DIR, "recent")   # rolling snapshot of the last N saves
DAILY_DIR = os.path.join(BACKUP_DIR, "daily")     # one snapshot per calendar day
KEEP_RECENT = 20                                   # rolling saves to retain
KEEP_DAILY = 30                                    # daily snapshots to retain (~1 month)
# Optional off-disk backup mirror. Point VOM_BACKUP_DIR at a USB drive or a
# Google Drive / OneDrive synced folder so backups survive a disk failure.
EXTERNAL_BACKUP_DIR = os.environ.get("VOM_BACKUP_DIR", "").strip()

# Firebase Globals
FIREBASE_ACTIVE = False
FIREBASE_ERROR = None
firebase_db_ref = None

# Subscription / License verification globals
SUBSCRIPTION_VALID = True
SUBSCRIPTION_ERROR = ""
CACHE_FILE = os.path.join(BASE_DIR, "license.cache")

# Serialize database file access. ThreadingHTTPServer handles each request in its
# own thread, so concurrent /api/save writes must be locked or they interleave
# and corrupt database.json.
DB_LOCK = threading.Lock()

def _prune(directory, keep):
    """Keep only the `keep` newest .json files in a backup directory."""
    files = sorted(glob.glob(os.path.join(directory, "*.json")), key=os.path.getmtime, reverse=True)
    for old in files[keep:]:
        try:
            os.remove(old)
        except OSError:
            pass

def write_backup(content):
    """Persist a rolling + daily snapshot. `content` is the already-serialized
    JSON string of a validated database. Never raises into the request path."""
    try:
        os.makedirs(RECENT_DIR, exist_ok=True)
        os.makedirs(DAILY_DIR, exist_ok=True)
        now = datetime.now()

        # Rolling recent snapshot (one file per save, bounded by KEEP_RECENT)
        recent_path = os.path.join(RECENT_DIR, f"save-{now.strftime('%Y%m%d-%H%M%S-%f')}.json")
        with open(recent_path, 'w', encoding='utf-8') as f:
            f.write(content)
        _prune(RECENT_DIR, KEEP_RECENT)

        # Daily snapshot (overwrites within the same day; latest state of that day)
        daily_name = f"{now.strftime('%Y-%m-%d')}.json"
        daily_path = os.path.join(DAILY_DIR, daily_name)
        with open(daily_path, 'w', encoding='utf-8') as f:
            f.write(content)
        _prune(DAILY_DIR, KEEP_DAILY)

        # Off-disk mirror of the daily snapshot (survives a disk failure).
        if EXTERNAL_BACKUP_DIR:
            try:
                ext_dir = os.path.join(EXTERNAL_BACKUP_DIR, "vittal-oil-mill-backups")
                os.makedirs(ext_dir, exist_ok=True)
                shutil.copy2(daily_path, os.path.join(ext_dir, daily_name))
            except Exception as ee:
                print(f"[Backup Warning] Off-disk mirror failed ({EXTERNAL_BACKUP_DIR}): {ee}")
    except Exception as e:
        print(f"[Backup Warning] Could not write backup: {e}")

# --- Concurrency-safe merge ---
# Every collection below is a list of records identified by `id`. When two staff
# save near-simultaneously we merge their changes by id onto the latest on-disk
# state instead of blindly overwriting, so nobody's new records are lost.
COLLECTIONS = [
    "unloads", "sales", "customers", "salesInvoices", "suppliers", "productionLogs",
    "refiningLogs", "machines", "activeCrushing", "payments", "spareParts",
    "maintenanceLogs", "transportLogs"
]

def merge_state(current, incoming, deletes):
    merged = dict(current)  # base = latest on disk (keeps others' concurrent changes)
    deletes = deletes if isinstance(deletes, dict) else {}
    for col in COLLECTIONS:
        cur_list = current.get(col) if isinstance(current.get(col), list) else []
        inc_list = incoming.get(col) if isinstance(incoming.get(col), list) else []
        by_id, order, raws = {}, [], []
        def absorb(records):
            for rec in records:
                rid = rec.get('id') if isinstance(rec, dict) else None
                if rid is None:
                    raws.append(rec)
                    continue
                if rid not in by_id:
                    order.append(rid)
                by_id[rid] = rec  # later writer (incoming) wins for same id
        absorb(cur_list)
        absorb(inc_list)
        del_ids = set(deletes.get(col, []) or [])
        merged[col] = [by_id[rid] for rid in order if rid not in del_ids] + raws
    # Non-collection keys (stockDaily, security, ...) take the incoming value when present.
    for k, v in incoming.items():
        if k in COLLECTIONS or k == '_rev':
            continue
        merged[k] = v
    return merged

def list_backups():
    """Return metadata for available backups, newest first per bucket."""
    out = {"recent": [], "daily": []}
    for bucket, directory in (("recent", RECENT_DIR), ("daily", DAILY_DIR)):
        if not os.path.isdir(directory):
            continue
        files = sorted(glob.glob(os.path.join(directory, "*.json")), key=os.path.getmtime, reverse=True)
        for path in files:
            try:
                st = os.stat(path)
                out[bucket].append({
                    "name": os.path.basename(path),
                    "bucket": bucket,
                    "size": st.st_size,
                    "modified": datetime.fromtimestamp(st.st_mtime).isoformat(timespec='seconds'),
                })
            except OSError:
                pass
    return out

def init_firebase():
    global FIREBASE_ACTIVE, FIREBASE_ERROR, firebase_db_ref
    if not os.path.exists(CONFIG_FILE) or not os.path.exists(KEY_FILE):
        # Fallback to local mode silently
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, db
    except ImportError:
        FIREBASE_ERROR = "firebase-admin package not installed. Run 'pip install firebase-admin'"
        print(f"\n[Firebase Config Detected] but: {FIREBASE_ERROR}\n")
        return

    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
        database_url = config.get("databaseURL")
        if not database_url:
            raise ValueError("databaseURL not found in firebase-config.json")

        if not firebase_admin._apps:
            cred = credentials.Certificate(KEY_FILE)
            firebase_admin.initialize_app(cred, {
                'databaseURL': database_url
            })
        
        firebase_db_ref = db.reference('vittal_oil_mill')
        FIREBASE_ACTIVE = True
        print(f"\n[Firebase] Connected & Active: {database_url}\n")
        
        # Startup sync
        sync_from_firebase_startup()
        # Check license
        check_subscription()
    except Exception as e:
        FIREBASE_ERROR = f"Failed to initialize Firebase: {str(e)}"
        print(f"\n[Firebase Error] {FIREBASE_ERROR}\n")


def check_subscription():
    global SUBSCRIPTION_VALID, SUBSCRIPTION_ERROR
    
    # 1. Load from cache on start/fallback
    cache_data = None
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
        except Exception:
            pass

    # 2. Check online if Firebase is connected
    if FIREBASE_ACTIVE:
        try:
            from firebase_admin import db
            import datetime
            ref = db.reference('subscription')
            sub_data = ref.get()
            if sub_data and isinstance(sub_data, dict):
                # Save to cache
                with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(sub_data, f)
                cache_data = sub_data
            elif not sub_data:
                # If node does not exist, initialize it (Active for 365 days by default)
                default_sub = {
                    "status": "active",
                    "expiry": (datetime.date.today() + datetime.timedelta(days=365)).strftime("%Y-%m-%d")
                }
                ref.set(default_sub)
                with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                    json.dump(default_sub, f)
                cache_data = default_sub
        except Exception as e:
            # Fallback to local cache if network call fails
            print(f"[Subscription] Remote check failed, using cached state: {e}")

    # 3. Evaluate subscription state using cache_data
    if cache_data and isinstance(cache_data, dict):
        status = cache_data.get('status', 'active')
        expiry = cache_data.get('expiry', '')
        
        if status == 'suspended':
            SUBSCRIPTION_VALID = False
            SUBSCRIPTION_ERROR = "Subscription Suspended"
        elif expiry:
            import datetime
            try:
                exp_date = datetime.datetime.strptime(expiry, "%Y-%m-%d").date()
                if datetime.date.today() > exp_date:
                    SUBSCRIPTION_VALID = False
                    SUBSCRIPTION_ERROR = f"Subscription Expired on {expiry}"
                else:
                    SUBSCRIPTION_VALID = True
                    SUBSCRIPTION_ERROR = ""
            except ValueError:
                SUBSCRIPTION_VALID = True
                SUBSCRIPTION_ERROR = ""
        else:
            SUBSCRIPTION_VALID = True
            SUBSCRIPTION_ERROR = ""
    else:
        # Safe default if no cache exists yet (allows first-time boot offline)
        SUBSCRIPTION_VALID = True
        SUBSCRIPTION_ERROR = ""

def sync_from_firebase_startup():
    global firebase_db_ref
    if not FIREBASE_ACTIVE or not firebase_db_ref:
        return
    try:
        print("[Firebase] Checking for updates from Firebase Cloud...")
        cloud_data = firebase_db_ref.get()
        if cloud_data:
            local_exists = os.path.exists(DB_FILE)
            local_size = os.path.getsize(DB_FILE) if local_exists else 0
            
            overwrite = False
            if not local_exists or local_size < 10:
                overwrite = True
            else:
                try:
                    with open(DB_FILE, 'r', encoding='utf-8') as f:
                        local_data = json.load(f)
                    # If cloud has more unloads than local, pull it
                    if len(cloud_data.get('unloads', [])) > len(local_data.get('unloads', [])):
                        overwrite = True
                except Exception:
                    overwrite = True
            
            if overwrite:
                with open(DB_FILE, 'w', encoding='utf-8') as f:
                    json.dump(cloud_data, f, indent=2, ensure_ascii=False)
                print("[Firebase] Successfully pulled latest database from cloud.")
            else:
                print("[Firebase] Local database matches or is ahead of cloud database.")
        else:
            print("[Firebase] Cloud database is empty. Sync pending next save.")
    except Exception as e:
        print(f"[Firebase Warning] Startup sync failed: {e}")

def save_to_firebase_async(data):
    global firebase_db_ref
    if not FIREBASE_ACTIVE or not firebase_db_ref:
        return
    try:
        firebase_db_ref.set(data)
        print("[Firebase] Cloud sync completed successfully in background.")
    except Exception as e:
        print(f"[Firebase Error] Background sync failed: {e}")

class VOMRequestHandler(http.server.SimpleHTTPRequestHandler):
    def serve_blocked_page(self, message):
        self.send_response(403)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Access Suspended</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
            <style>
                body {{
                    margin: 0; padding: 0;
                    background-color: #0f172a;
                    color: #f1f5f9;
                    font-family: 'Outfit', sans-serif;
                    display: flex; align-items: center; justify-content: center;
                    height: 100vh; text-align: center;
                }}
                .card {{
                    background: #1e293b;
                    padding: 3rem; border-radius: 16px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                    max-width: 450px; border: 1px solid #334155;
                }}
                h1 {{ color: #ef4444; font-size: 2rem; margin-bottom: 1rem; }}
                p {{ color: #94a3b8; font-size: 1.1rem; line-height: 1.6; margin-bottom: 2rem; }}
                .info {{
                    background: #0f172a; padding: 1rem; border-radius: 8px;
                    font-size: 0.9rem; color: #38bdf8; font-weight: 600;
                    margin-bottom: 2rem; border: 1px solid #1e293b;
                }}
                .btn {{
                    background: #0ea5e9; color: #fff;
                    padding: 0.75rem 1.5rem; border-radius: 8px;
                    text-decoration: none; font-weight: 600;
                    transition: background 0.2s;
                }}
                .btn:hover {{ background: #0284c7; }}
            </style>
        </head>
            <body>
                <div class="card">
                    <div style="font-size: 4rem; margin-bottom: 1rem;">⚠️</div>
                    <h1>System Access Suspended</h1>
                    <p>The Vitthal Oil Mill ERP subscription is currently inactive or has expired. Please contact your system administrator to renew access.</p>
                    <div class="info">Reason: {message}</div>
                    <a href="https://vittal-oil-mill.web.app/" class="btn" style="background:#475569; margin-right:10px;">Check Status</a>
                    <a href="mailto:support@vittaloilmill.com" class="btn">Contact Developer</a>
                </div>
            </body>
        </html>
        """
        self.wfile.write(html.encode('utf-8'))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        super().end_headers()

    def do_GET(self):
        if self.path not in ('/favicon.ico',):
            check_subscription()
            
        if not SUBSCRIPTION_VALID:
            if self.path.startswith('/api/'):
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": f"License Blocked: {SUBSCRIPTION_ERROR}"}).encode('utf-8'))
            else:
                self.serve_blocked_page(SUBSCRIPTION_ERROR)
            return
        if self.path == '/api/load':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
            self.end_headers()
            if os.path.exists(DB_FILE):
                try:
                    with DB_LOCK:
                        with open(DB_FILE, 'r', encoding='utf-8') as f:
                            content = f.read()
                    json.loads(content)
                    self.wfile.write(content.encode('utf-8'))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": f"Failed to load: {str(e)}"}).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({}).encode('utf-8'))
        elif self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            status_data = {
                "firebase_active": FIREBASE_ACTIVE,
                "firebase_error": FIREBASE_ERROR,
                "backups": list_backups()
            }
            self.wfile.write(json.dumps(status_data).encode('utf-8'))
        elif self.path == '/api/backups':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(list_backups()).encode('utf-8'))
        else:
            super().do_GET()

    def _resolve_backup(self, bucket, name):
        """Safely resolve a backup path, blocking any traversal outside BACKUP_DIR."""
        if bucket not in ('recent', 'daily') or not name or os.path.basename(name) != name:
            return None
        directory = RECENT_DIR if bucket == 'recent' else DAILY_DIR
        path = os.path.abspath(os.path.join(directory, name))
        if not path.startswith(os.path.abspath(directory) + os.sep) or not path.endswith('.json'):
            return None
        return path if os.path.isfile(path) else None

    def do_POST(self):
        check_subscription()
        if not SUBSCRIPTION_VALID:
            self.send_response(403)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": f"License Blocked: {SUBSCRIPTION_ERROR}"}).encode('utf-8'))
            return
        if self.path == '/api/save':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                body = json.loads(post_data.decode('utf-8'))
                # v2 clients send {payload, baseRev, deletes} and get a merge; a raw
                # state body (legacy / offline import) is written directly.
                is_v2 = isinstance(body, dict) and 'payload' in body
                incoming = body.get('payload') if is_v2 else body
                deletes = body.get('deletes') if is_v2 else {}

                with DB_LOCK:
                    current = {}
                    if os.path.exists(DB_FILE):
                        try:
                            with open(DB_FILE, 'r', encoding='utf-8') as f:
                                current = json.loads(f.read())
                        except Exception:
                            current = {}
                    if is_v2:
                        final = merge_state(current, incoming, deletes)
                    else:
                        final = incoming
                    final['_rev'] = (current.get('_rev', 0) if isinstance(current, dict) else 0) + 1
                    serialized = json.dumps(final, indent=2, ensure_ascii=False)
                    tmp_path = DB_FILE + '.tmp'
                    with open(tmp_path, 'w', encoding='utf-8') as f:
                        f.write(serialized)
                    os.replace(tmp_path, DB_FILE)
                    write_backup(serialized)

                # Cloud sync trigger
                if FIREBASE_ACTIVE:
                    threading.Thread(target=save_to_firebase_async, args=(final,), daemon=True).start()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                # Return the authoritative merged state so the client adopts others' changes.
                self.wfile.write(json.dumps({"status": "success", "rev": final['_rev'], "data": final}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
        elif self.path == '/api/restore':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                req = json.loads(post_data.decode('utf-8'))
                path = self._resolve_backup(req.get('bucket'), req.get('name'))
                if not path:
                    raise ValueError("Backup not found or invalid.")
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                json.loads(content)  # validate before restoring
                with DB_LOCK:
                    # Snapshot the current state first, then swap in the backup.
                    if os.path.exists(DB_FILE):
                        with open(DB_FILE, 'r', encoding='utf-8') as f:
                            write_backup(f.read())
                    tmp_path = DB_FILE + '.tmp'
                    with open(tmp_path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    os.replace(tmp_path, DB_FILE)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    # Initialize Firebase if credential files exist
    init_firebase()

    # Take an immediate backup of whatever is on disk at startup.
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                write_backup(f.read())
            print("[Backup] Startup snapshot saved to /backups.")
        except Exception as e:
            print(f"[Backup Warning] Startup snapshot failed: {e}")

    server_address = ('', PORT)
    # ThreadingHTTPServer: handle each connection in its own thread so a single
    # keep-alive browser connection can't block every other client (which made
    # the dashboard "not open" in a second browser).
    httpd = http.server.ThreadingHTTPServer(server_address, VOMRequestHandler)
    print(f"Vitthal Oil Mill OS Server running on http://localhost:{PORT}")
    print(f"Network access enabled via Host IP on port {PORT}")
    
    def open_browser():
        try:
            time.sleep(1)
            webbrowser.open(f"http://localhost:{PORT}")
        except Exception as e:
            print(f"Failed to auto-open browser: {e}")

    # Skip the browser pop when running as a background/auto-start server.
    if not os.environ.get("VOM_NO_BROWSER"):
        threading.Thread(target=open_browser, daemon=True).start()
        
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()
        sys.exit(0)

