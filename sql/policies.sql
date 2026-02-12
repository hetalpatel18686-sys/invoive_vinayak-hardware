
-- Enable RLS
alter table public.customers enable row level security;
alter table public.items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.stock_moves enable row level security;
alter table public.profiles enable row level security;

-- Profiles: user can read own profile; admin can read all; only admin can update roles
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin());
create policy profiles_insert_self on public.profiles for insert to authenticated with check (id = auth.uid() or public.is_admin());

-- Customers
create policy customers_read on public.customers for select to authenticated using (true);
create policy customers_insert on public.customers for insert to authenticated with check (true);
create policy customers_update on public.customers for update to authenticated using (public.is_admin());
create policy customers_delete on public.customers for delete to authenticated using (public.is_admin());

-- Items
create policy items_read on public.items for select to authenticated using (true);
create policy items_insert on public.items for insert to authenticated with check (public.is_admin());
create policy items_update on public.items for update to authenticated using (public.is_admin());
create policy items_delete on public.items for delete to authenticated using (public.is_admin());

-- Invoices (read/insert by staff; modify/delete admin only)
create policy invoices_read on public.invoices for select to authenticated using (true);
create policy invoices_insert on public.invoices for insert to authenticated with check (true);
create policy invoices_update on public.invoices for update to authenticated using (public.is_admin());
create policy invoices_delete on public.invoices for delete to authenticated using (public.is_admin());

-- Invoice items follow invoices rules (insert by staff when creating invoice)
create policy invoice_items_read on public.invoice_items for select to authenticated using (true);
create policy invoice_items_insert on public.invoice_items for insert to authenticated with check (true);
create policy invoice_items_update on public.invoice_items for update to authenticated using (public.is_admin());
create policy invoice_items_delete on public.invoice_items for delete to authenticated using (public.is_admin());

-- Stock moves: insert by staff (receive/adjust/issue), updates/deletes admin only
create policy stock_moves_read on public.stock_moves for select to authenticated using (true);
create policy stock_moves_insert on public.stock_moves for insert to authenticated with check (true);
create policy stock_moves_update on public.stock_moves for update to authenticated using (public.is_admin());
create policy stock_moves_delete on public.stock_moves for delete to authenticated using (public.is_admin());
