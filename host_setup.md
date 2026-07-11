# Vitthal Oil Mill OS – Host Laptop Installation & Operations Guide

This guide details how to run, host, back up, and share the **Vitthal Oil Mill OS** on your laptop and local office network.

---

## 1. Quick Start Launcher (One-Click)

Inside this folder, we have created a Windows batch script: **`Launch ERP.bat`**.

1. Double-click **[Launch ERP.bat](file:///c:/Users/rishi/Downloads/vittal%20oil%20mill/Launch%20ERP.bat)**.
2. It will automatically:
   - Launch your default web browser (Chrome/Edge) to the server link: **`http://127.0.0.1:4567`**.
   - Start a lightweight background server in the command prompt.
3. **Keep the command prompt window open** while using the dashboard. To close the server, simply close the command prompt window.

*Note: If your laptop does not have Python installed, the script will automatically open the dashboard file directly in offline mode (`index.html`), which is fully functional.*

---

## 2. Moving the Application to a Different Laptop

Because this is a portable Single Page Application (SPA), migrating to a new host laptop is extremely simple:

1. Copy the entire folder (`vittal oil mill`) onto a USB thumb drive.
2. Paste the folder onto the Desktop or Downloads folder of the new laptop.
3. Open the folder and double-click **`Launch ERP.bat`** to run it. No installations or installations configurations are needed!

---

## 3. Accessing the Dashboard from Mobile Phones / Tablets

You can access and log logs (like seed unloads) on the dashboard from **other laptops, tablets, or smartphones** connected to the same office Wi-Fi router. 

### Step 1: Find the Host Laptop's Local IP Address
1. Press `Win + R` on the host laptop, type `cmd`, and press Enter.
2. In the command prompt, type:
   ```text
   ipconfig
   ```
3. Look for the row named **IPv4 Address** (it will look like `192.168.1.15` or `10.0.0.8`).

### Step 2: Open the Link on Other Devices
1. Make sure your smartphone or tablet is connected to the same Wi-Fi router.
2. Open Chrome/Safari on that device and go to:
   ```text
   http://<HOST-IP-ADDRESS>:4567
   ```
   *(For example: `http://192.168.1.15:4567`)*
3. You can now log raw unloads directly from the weighing scale cabin or warehouse floor!

---

## 4. Data Safety & Backup Procedures

All logs, customer lists, inventories, and archived invoices are saved directly in your web browser's local cache. If you clear your browser cookies or history, this data could be wiped. 

### Weekly Backup Routine:
1. Open the dashboard.
2. Click the **Database** tab on the left sidebar.
3. Click **Export Data Backup**. This will download a `.json` backup file containing your entire mill database.
4. Keep this file in a safe folder on your laptop or upload it to Google Drive.

### Restoring Data:
If you use a new browser or clear cache:
1. Open the dashboard.
2. Go to the **Database** tab.
3. Click **Upload Backup File** under *Restore Database*, choose your latest `.json` backup file, and press Open. All your records will be restored instantly!
