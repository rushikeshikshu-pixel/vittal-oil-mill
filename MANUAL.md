# Vitthal Oil Mill OS — User & Operations Manual

Welcome to your Mill Management System! This manual explains how to use each tab of the dashboard to manage daily operations, track finances, and analyze plant performance.

---

## 🔑 Accessing the System
By default, the login screen is disabled. If you enable it under the **Database** tab, you can log in using these PIN codes:
*   **Anand (Owner)**: `4321` (Full access, delete permissions, settings, and database backups).
*   **Accountant**: `3333` (Party Accounts, Invoices, and Data Analytics).
*   **Plant Supervisor**: `2222` (Crushing Production, Refining, Spares, and Maintenance).
*   **Weighbridge Operator**: `1111` (Seed Unloads and Sales Dispatches).

---

## 📥 1. Unloads Tab (Raw Material Receipts)
Use this tab to record incoming cotton seed lorries.
*   **How to Log**: Click **`Record Lorry Entry`**. Enter Lorry No, Supplier Name, Date, Invoice Weight, Net Received Weight (from weighing bridge), Purchase Rate, and Freight charges.
*   **Packaging (Bardan)**: Specify the type of bags used (Jute or Plastic) and quantity. The system automatically updates your packaging bag inventory.
*   **Shortage**: The system automatically calculates any weight shortage between the invoice and received weight.

---

## 📤 2. Sales Tab (Finished Dispatches)
Use this tab to record sales dispatches of Oil, Cake, Hulls, or Kandi.
*   **How to Log**: Click **`Record Dispatch Entry`**. Select the Customer, Product, Weight, Rate, and Lorry No.
*   **Instant Stock Update**: Saving a dispatch automatically subtracts the weight and packaging bags from your stock ledger.

---

## 🏭 3. Production Tab (Expeller Crushing Logs)
Use this tab to record daily expeller crushing runs.
*   **How to Log**: Click **`Log Crushing Run`**. Select the parent Seed Unload lot, enter the total seed weight crushed, and the outputs obtained (Crude Oil, Cake/Khal, and Cotton Hulls).
*   **Efficiency Tracking**: The system calculates the plant recovery yield percentage. A normal run should achieve a **98% to 99%** recovery yield.

---

## 🧪 4. Oil Refining Tab (Refinery Logs)
Use this tab to log oil refining batches.
*   **How to Log**: Click **`Log Refining Batch`**. Enter the input Crude Oil weight, and the outputs obtained (Refined Wash Oil, Acid Oil, and Soap Stock).
*   **Loss Tracking**: The system displays the refining loss weight and percentage automatically.

---

## 💰 5. Party Accounts Tab (Financial Ledger)
Manage outstanding balances for all suppliers and customers.
*   **Ledger view**: Select any party name to view their complete transaction history, including purchases, sales, and payments.
*   **Payments & Receipts**: Click **`Record Payment/Payout`** to log cash/bank payouts to suppliers or receipts from customers. Balances update instantly in real-time.

---

## 📊 6. Stock Statement Tab (Inventory Ledger)
Tracks your physical stock levels of raw cotton seed and finished products.
*   **Dynamic Calculations**: Daily stocks are calculated automatically based on purchases, production, and sales.
*   **Manual Overrides**: If a physical stock count differs, click the edit button on any grid cell to write a manual override. Click "Reset to Auto" to fall back to system calculations.

---

## 🔧 7. Spare Parts & Maintenance Tabs
Track machinery upkeep and expeller parts inventory.
*   **Spares Catalog**: Lists all expeller shafts, cones, filter press plates, and gaskets. Low stock items show red warnings.
*   **Log Repair**: When logging a repair job, specify which spare parts were used. The system will automatically deduct those parts from your inventory catalog.

---

## 🚛 8. Transport Fleet Tab
Tracks usage, maintenance, and fuel logs for mill vehicles (JCBs, tractors, delivery trucks).
*   **Mileage Efficiency**: Tracks km/L for trucks, and Litres/Hour for JCB excavators.
*   **Diesel Fuel Log**: Log fuel fill-ups to track monthly fleet fuel expenses.

---

## 📄 9. Invoice Builder
Generate professional tax invoices for your dispatches.
*   **How to Build**: Select a Customer and click **`Create Invoice`**. Check the dispatches you want to bill, customize GST rates ($5\%$ or $18\%$), add discounts, and print or export a clean PDF invoice.

---

## 📈 10. Data Analytics Tab
View high-level business metrics to monitor mill profitability:
*   **Gross Margin**: Monthly chart comparing total Sales Revenue vs. raw material Purchase Costs.
*   **Product Sales Mix**: Doughnut chart showing which products represent the largest volume of sales.
*   **Yield Trends**: Line chart tracking expeller crushing efficiency across all production logs.
