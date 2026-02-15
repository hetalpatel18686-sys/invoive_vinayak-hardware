'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Button from '@/components/Button';

type MoveType = 'receive' | 'adjust' | 'issue' | 'return';

interface FoundItem {
  id: string;
  sku: string;
  name: string | null;
  description?: string | null;
  stock_qty?: number;
  unit_cost?: number;
  uom_code?: string;
  low_stock_threshold?: number | null;
}

interface MoveRow {
  created_at: string;
  move_type: string;
  qty: number;
  ref: string | null;
  uom_code: string | null;
  unit_cost: number | null;
  total_cost: number | null;
  item: { sku: string; name: string } | null;
}

interface InvRow {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  unit_cost: number;
  uom_code: string;
  low_stock_threshold: number | null;
}

interface UomRow {
  id: string;
  code: string;
  name: string;
}

/** ---------- Types to safely read `uom.code` ---------- */
type Uom = { code?: string; name?: string };
type UomField = Uom | Uom[] | null | undefined;

function getUomCode(u: UomField): string {
  if (Array.isArray(u)) return u[0]?.code ?? '';
  return u?.code ?? '';
}

export default function Stock() {
  // --- Left panel: fast entry
  const [sku, setSku] = useState<string>('');
  const [found, setFound] = useState<FoundItem | null>(null);

  const [moveType, setMoveType] = useState<MoveType>('receive');
  const [qty, setQty] = useState<number>(0);            // adjust: can be negative
  const [unitCost, setUnitCost] = useState<number>(0);  // purchase cost (receive)
  const [ref, setRef] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Minimum (low-stock threshold) editor for found item
  const [minQty, setMinQty] = useState<number>(0);
  const [savingMin, setSavingMin] = useState<boolean>(false);

  // --- Right panel: tabs
  const [activeTab, setActiveTab] = useState<'moves' | 'inventory'>('moves');

  // Movements
  const [history, setHistory] = useState<MoveRow[]>([]);
  // Inventory
  const [invRows, setInvRows] = useState<InvRow[]>([]);
  const [invLoading, setInvLoading] = useState<boolean>(true);
  const [invSearch, setInvSearch] = useState<string>('');
  const [invLowOnly, setInvLowOnly] = useState<boolean>(false);

  useEffect(() => {
    loadHistory();
    loadInventory();
  }, []);

  /* ---------- Loads ---------- */

  const loadHistory = async () => {
    const h = await supabase
      .from('stock_moves')
      .select(`
        created_at, move_type, qty, ref, uom_code, unit_cost, total_cost,
        item:items ( name, sku )
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    const rows: MoveRow[] =
      (h.data ?? []).map((r: any) => ({
        created_at: r.created_at,
        move_type: r.move_type,
        qty: Number(r.qty ?? 0),
        ref: r.ref ?? null,
        uom_code: r.uom_code ?? null,
        unit_cost: r.unit_cost ?? null,
        total_cost: r.total_cost ?? null,
        item: Array.isArray(r.item) ? (r.item[0] ?? null) : r.item ?? null,
      })) ?? [];

    setHistory(rows);
  };

  const loadInventory = async () => {
    setInvLoading(true);

    // Items (no join)
    const { data: itemsData, error: itemsErr } = await supabase
      .from('items')
      .select('id, sku, name, stock_qty, unit_cost, low_stock_threshold, uom_id')
      .order('sku', { ascending: true });

    if (itemsErr) {
      setInvRows([]);
      setInvLoading(false);
      return;
    }

    // UoMs → map
    const { data: uomData } = await supabase
      .from('units_of_measure')
      .select('id, code, name');

    const uomMap: Record<string, UomRow> = {};
    (uomData ?? []).forEach((u: any) => {
      uomMap[u.id] = { id: u.id, code: u.code, name: u.name };
    });

    const rows: InvRow[] = (itemsData ?? []).map((it: any) => {
      const u = it.uom_id ? uomMap[it.uom_id] ?? null : null;
      return {
        id: it.id,
        sku: it.sku,
        name: it.name,
        stock_qty: Number(it.stock_qty ?? 0),
        unit_cost: Number(it.unit_cost ?? 0),
        low_stock_threshold: it.low_stock_threshold ?? null,
        uom_code: u?.code ?? '',
      };
    });

    setInvRows(rows);
    setInvLoading(false);
  };

  /* ---------- Find by SKU (case insensitive) ---------- */
  const findBySku = async () => {
    setFound(null);
    const trimmed = sku.trim();
    if (!trimmed) return alert('Please enter SKU');

    // Case-insensitive EXACT match (no wildcards)
    const { data, error } = await supabase
      .from('items')
      .select(`
        id, sku, name, description, stock_qty, unit_cost, low_stock_threshold,
        uom:units_of_measure ( code )
      `)
