# Vitthal Oil Mill OS — Production Setup Guide (Office PC)

This guide turns the mill's **office PC** into the permanent server that hosts the
dashboard and its database for all staff. Do this **once**.

> The office PC is the single source of truth. Every phone, tablet, and laptop
> connects to it. Keep it **switched on** during (and ideally beyond) working hours.

---

## One-time setup (about 15 minutes)

### Step 1 — Install Python
1. Go to **https://www.python.org/downloads/** and download Python 3 for Windows.
2. Run the installer and **tick "Add python.exe to PATH"** at the bottom before clicking Install.
3. Finish the install.

### Step 2 — Copy the application folder onto the office PC
1. Copy the whole **`vittal oil mill`** folder to a permanent location, e.g. `C:\VittalOilMill`.
   (Do **not** run it from a USB stick or the Downloads folder long-term.)
2. Your live data is the file **`database.json`** inside it — this is the mill's records.

### Step 3 — Turn on off-disk backups (important)
The server already auto-backs-up to a `backups` folder, but that's on the *same disk*.
To survive a disk failure, also copy backups somewhere off the PC:

1. Install **Google Drive for Desktop** or **OneDrive** (or plug in a permanent USB drive).
2. Edit **`run-server.bat`** (right-click → Edit). Find this line near the top:
   ```
   REM set VOM_BACKUP_DIR=G:\My Drive\VittalMillBackups
   ```
   Remove the `REM ` and set it to your Drive/USB folder, for example:
   ```
   set VOM_BACKUP_DIR=G:\My Drive\VittalMillBackups
   ```
3. Save the file. A daily copy of the database will now also land there automatically.

### Step 4 — Make the server start automatically
1. Right-click **`install-autostart.ps1`** → **Run with PowerShell** (approve the admin prompt).
2. It registers the server to **start on boot and restart itself if it ever stops**,
   and starts it immediately.
3. You should see a green **SUCCESS** message.

### Step 5 — Confirm it works
Open a browser on the office PC and go to **http://localhost:4567** — the dashboard should load.

### Step 6 — Connect other devices (same Wi-Fi)
1. On the office PC, open Command Prompt and run `ipconfig`. Note the **IPv4 Address**
   (e.g. `192.168.1.20`).
2. On any phone/tablet/laptop on the same Wi-Fi, open `http://<that-IP>:4567`.
   *(Remote access from outside the mill is set up separately — see "Remote Access" below.)*

---

## Everyday operation
- **Leave the office PC on.** If it's off, the mill's software is down for everyone.
- **Backups are automatic** — every save and once per day, plus the off-disk copy from Step 3.
- Nobody needs to keep a black command window open; the server runs in the background.

## Restoring data
- In the app, open the **Database** tab → **Automatic Backups** → pick a snapshot → **Restore**.
  Your current data is snapshotted first, so a restore is always reversible.
- Worst case (PC dies): install the app on a new PC (Steps 1–2), drop your latest
  backup `.json` in as `database.json`, and run Step 4.

## Turning auto-start off
- Right-click `install-autostart.ps1` → Run with PowerShell, but first change the run
  command to include `-Uninstall`, or run in PowerShell:
  `powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Uninstall`

---

## Remote Access (from home / off-site)
Set up with a private tunnel (Tailscale) so staff can reach the dashboard from anywhere
**without exposing the mill's data to the public internet**. See **REMOTE_ACCESS.md**
*(provided separately)*.

## Security note
Staff role logins (Database tab → Roles & Access) organise who does what. They are a
**workflow control, not data encryption** — anyone with direct access to this PC or the
`database.json` file can still read it. Keep the office PC physically secure and its
Windows account password-protected.
