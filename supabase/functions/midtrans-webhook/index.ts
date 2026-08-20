import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

serve(async (req) => {
  try {
    const body = await req.json();
    const { order_id, transaction_status } = body;

    // 1. Hanya proses jika statusnya 'settlement' (Berhasil)
    if (transaction_status === 'settlement') {
      
      // 2. Ambil data transaksi
      const { data: transaksi, error: errTrx } = await supabaseAdmin
        .from('transaksi')
        .select('*')
        .eq('no_struk', order_id)
        .single();

      if (errTrx || !transaksi) return new Response('Transaction not found', { status: 404 });

      // 3. JIKA SUDAH LUNAS, JANGAN PROSES ULANG STOK & POIN
      const sudahLunas = transaksi.status_transaksi === 'Lunas';

      if (!sudahLunas) {
        // --- A. PROSES POTONG STOK ---
        if (transaksi.detail_pesanan && Array.isArray(transaksi.detail_pesanan)) {
          for (let item of transaksi.detail_pesanan) {
            const { data: p } = await supabaseAdmin.from('produk').select('stok').eq('id', item.id).single();
            if (p) {
              await supabaseAdmin.from('produk').update({ stok: p.stok - item.jumlah }).eq('id', item.id);
            }
          }
        }

        // --- B. PROSES POIN PELANGGAN (DIPERBAIKI) ---
        // Mendukung kolom bernama 'pelanggan' atau 'nama_pelanggan'
        const namaPlg = transaksi.pelanggan || transaksi.nama_pelanggan; 
        
        if (namaPlg && namaPlg !== "Umum" && namaPlg !== "Umum / Cash") {
          // Cari murni hanya berdasarkan kolom 'nama' agar tidak terjadi error tipe data
          const { data: plg } = await supabaseAdmin
            .from('pelanggan')
            .select('id, total_poin')
            .eq('nama_pelanggan', namaPlg)
            .maybeSingle();

          if (plg) {
            let totalAkhir = parseFloat(transaksi.total_akhir) || 0;
            let poinDidapat = Math.floor(totalAkhir / 10000);
            
            let poinLama = parseInt(plg.total_poin) || 0;
            let poinDipakai = parseInt(transaksi.poin_dipakai) || 0;
            
            let poinBaru = poinLama - poinDipakai + poinDidapat;
            if (poinBaru < 0) poinBaru = 0;

            await supabaseAdmin.from('pelanggan').update({ total_poin: poinBaru }).eq('id', plg.id);
          }
        }

        // --- C. UPDATE STATUS TRANSAKSI JADI LUNAS ---
        await supabaseAdmin.from('transaksi').update({ status_transaksi: 'Lunas' }).eq('no_struk', order_id);
      }

      // --- D. CEGAH DUPLIKASI ARUS KAS ---
      const { data: existingKas } = await supabaseAdmin
        .from('arus_kas')
        .select('id')
        .ilike('keterangan', `%${order_id}%`)
        .maybeSingle();

      if (!existingKas) {
        let totalAkhir = parseFloat(transaksi.total_akhir) || 0;
        let nilaiPembulatan = parseFloat(transaksi.pembulatan) || 0;
        let omsetPenuh = totalAkhir + nilaiPembulatan;

        await supabaseAdmin.from('arus_kas').insert({
          klien_id: transaksi.klien_id,
          tanggal: new Date().toISOString(),
          tipe: 'Penjualan',
          akun_asal: 'Midtrans',
          akun_tujuan: 'Midtrans',
          nominal: omsetPenuh,
          keterangan: "Penjualan Struk: " + order_id,
          kasir: transaksi.kasir || 'Sistem',
          status: 'Selesai'
        });
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error("Error Webhook:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }
});