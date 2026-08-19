import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const midtransData = await req.json();
      const { order_id, transaction_status, fraud_status } = midtransData;
      
      let statusAkhir = "Pending";
      if (transaction_status == 'capture') {
        statusAkhir = (fraud_status == 'challenge') ? "Menunggu Validasi" : "Lunas";
      } else if (transaction_status == 'settlement') {
        statusAkhir = "Lunas";
      } else if (transaction_status == 'cancel' || transaction_status == 'deny' || transaction_status == 'expire') {
        statusAkhir = "Batal";
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // 1. Cari transaksi di tabel berdasarkan no_struk
      const { data: trxData, error: errGet } = await supabase
        .from('transaksi')
        .select('*')
        .eq('no_struk', order_id)
        .single();

      if (errGet || !trxData) {
        console.error("Transaksi tidak ditemukan:", order_id);
        return new Response("Transaksi tidak ditemukan", { status: 200 });
      }

      // ✨ PERBAIKAN: Gunakan nama kolom yang benar yaitu 'status_transaksi'
      const statusLama = trxData.status_transaksi;

      // 2. Update Status Pembayaran Transaksi
      const { error: errUpdate } = await supabase
        .from('transaksi')
        .update({ status_transaksi: statusAkhir }) // ✨ Diperbaiki di sini
        .eq('no_struk', order_id);

      if (errUpdate) throw errUpdate;

      // 3. Catat ke Arus Kas jika status baru menjadi Lunas
      if (statusAkhir === "Lunas" && statusLama !== "Lunas" && statusLama !== "Sukses") {
        const { error: errKas } = await supabase.from('arus_kas').insert([{
          klien_id: trxData.klien_id,
          tipe: "Penjualan",
          akun_asal: "Midtrans", 
          nominal: trxData.total_akhir, // Pastikan ini sesuai dengan nama kolom di tabel transaksi
          keterangan: "Penjualan Struk: " + order_id,
          kasir: trxData.kasir || "Sistem"
        }]);
        
        if (errKas) console.error("Arus kas gagal dicatat:", errKas);
      }

      return new Response("OK", { status: 200 });

    } catch (error: any) {
      console.error("Webhook Error:", error);
      return new Response("Error: " + error.message, { status: 500 });
    }
  }
};
