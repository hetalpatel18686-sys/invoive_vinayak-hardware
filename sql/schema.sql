
-- Core schema for Customers, Items, Invoices, Invoice Items, Stock Moves

create extension if not exists pgcrypto; -- for gen_random_uuid

-- Customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text unique,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  created_at timestamptz default now()
);

-- Items
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null,
  description text,
  unit_cost numeric(12,2) not null default 0,
  unit_price numeric(12,2) not null default 0,
  tax_rate numeric(5,2) default 0,
  stock_qty integer not null default 0,
  low_stock_threshold integer default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Invoices
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text unique not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft',
  notes text,
  private_notes text,
  subtotal numeric(12,2) default 0,
  tax_total numeric(12,2) default 0,
  discount_total numeric(12,2) default 0,
  grand_total numeric(12,2) default 0,
  issued_at date,
  due_at date,
  created_at timestamptz default now()
);

-- Invoice line items
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id) on delete cascade,
  item_id uuid references public.items(id),
  description text,
  qty numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  tax_rate numeric(5,2) default 0,
  line_total numeric(12,2) not null default 0
);

-- Stock movements
create table if not exists public.stock_moves (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.items(id) on delete cascade,
  move_type text not null check (move_type in ('receive','adjust','issue')),
  qty integer not null,
  ref text,
  reason text,
  created_at timestamptz default now()
);

-- Trigger: apply stock change on insert
create or replace function public.apply_stock_move() returns trigger as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.move_type in ('receive','adjust') then
      update public.items set stock_qty = stock_qty + NEW.qty where id = NEW.item_id;
    elsif NEW.move_type = 'issue' then
      update public.items set stock_qty = stock_qty - NEW.qty where id = NEW.item_id;
    end if;
  end if;
  return NEW;
end; $$ language plpgsql;

drop trigger if exists trg_apply_stock_move on public.stock_moves;
create trigger trg_apply_stock_move after insert on public.stock_moves
for each row execute function public.apply_stock_move();

-- Profiles & role helper
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz default now()
);

create or replace function public.is_admin() returns boolean as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$ language sql stable;
