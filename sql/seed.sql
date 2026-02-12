
-- Sample data for quick testing
insert into public.customers (first_name, last_name, email, phone, city, state, postal_code)
values
('John','Miller','john@example.com','+1 555-1234','Miami','FL','33101'),
('Priya','Shah','priya@example.com','+1 555-2222','Dallas','TX','75201');

insert into public.items (sku, name, description, unit_cost, unit_price, tax_rate, stock_qty, low_stock_threshold)
values
('SKU-1001','Steel Screw 2"','Box of 100', 2.50, 4.50, 7.5, 500, 50),
('SKU-2001','PVC Pipe 1/2"','Length 1m', 1.10, 2.00, 7.5, 200, 20);
