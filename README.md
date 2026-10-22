# MOJIRA — Luxe by Mojirade Ojasope

An online store for women's shoes, women's bags and wristwatches for women and men.
It has a customer storefront and an owner dashboard where the owner adds products, prices and stock herself.

## Start the store

```
npm install      (first time only)
npm start
```

- Store: http://localhost:5050
- Owner dashboard: http://localhost:5050/admin (there's also an "Owner login" link in the footer)
- **Default password: `mojira2026`.** Change it right away under **Settings → Change password**.

## What the owner can do (dashboard)

| Section | What it does |
|---|---|
| **Overview** | Totals for products, stock value, orders and sales, plus a list of new orders and items that are low on stock or sold out |
| **Products** | Add, edit or delete products: photo, name, category, price, sale price, quantity and description. Use **− / +** or type a number to change stock |
| **Orders** | See each customer's order, phone number and address. Set the status (pending → confirmed → shipped → delivered) and message the customer on WhatsApp. **Cancelling an order puts its items back in stock** |
| **Settings** | Store name, WhatsApp number, phone, email, bank account details shown at checkout, and the delivery fee |

## How customers buy

1. They browse by category, search or sort, then add items to their bag.
2. At checkout they enter their name, phone and delivery address.
3. They see your bank details and an order reference, such as `MJ1001`, and send their receipt to you on WhatsApp with one tap.
4. Stock goes down as soon as an order is placed, so nobody can buy more than you have.

## Where things are saved

- `data/products.json`, `data/orders.json`, `data/settings.json`: all store data
- `uploads/`: product photos

Back up these two folders. To reset the store, stop the server and delete `data/`. The sample products come back the next time it starts.

## Put it online (Render)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alabiabeeb/mojira-store)

1. Click the button above and sign in to Render with GitHub.
2. When Render asks for `ADMIN_PASSWORD`, choose the owner password. The online store uses it instead of the default one.
3. Click **Apply**. After a few minutes the store is live at `https://mojira-store.onrender.com` or a similar address.

`render.yaml` sets up a 1GB persistent disk, so products, orders and photos are kept between restarts. That needs Render's Starter plan, about $7 a month. On the free plan, data is wiped whenever the server restarts.

To use a different port, run `PORT=8080 npm start` on Mac or Linux, or `$env:PORT=8080; npm start` in PowerShell.
