-- Supabase Database Migration Script - Aura Finance
-- 
-- PETUNJUK PEMAKAIAN (INDONESIAN INSTRUCTIONS):
-- 1. Buka dashboard Supabase Anda (https://supabase.com).
-- 2. Pilih proyek Anda, lalu buka menu "SQL Editor" dari sidebar sebelah kiri.
-- 3. Klik "New query" untuk membuat tab query baru.
-- 4. Salin dan tempel (paste) seluruh kode SQL di bawah ini.
-- 5. Klik tombol "Run" di bagian kanan bawah editor untuk mengeksekusi script.
-- 6. Setelah berhasil dijalankan, tabel 'transactions' akan dibuat dengan sistem keamanan Row Level Security (RLS) aktif.

-- 1. Hapus tabel jika sudah ada (Opsional, gunakan dengan hati-hati)
-- DROP TABLE IF EXISTS public.transactions;

-- 2. Membuat tabel transaksi
CREATE TABLE public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount >= 0),
    category TEXT NOT NULL,
    description TEXT,
    date TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Membuat index untuk performa query pencarian berdasarkan user_id dan tanggal
CREATE INDEX idx_transactions_user_date ON public.transactions (user_id, date DESC);

-- 4. Mengaktifkan fitur Row Level Security (RLS) pada tabel transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 5. Membuat policy akses tunggal untuk ALL operasi (SELECT, INSERT, UPDATE, DELETE)
-- Pengguna hanya bisa membaca dan memodifikasi data milik mereka sendiri.
CREATE POLICY "Users can fully manage their own transactions" 
ON public.transactions
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
