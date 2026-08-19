import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.7.1";

export default {
  async fetch(req: Request) {
    // Tolak jika bukan POST (Midtrans selalu mengirim POST)
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

      // Hubungkan ke Supabase secara manual dengan Service Key agar punya hak tulis (Update/Insert)
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      // 1. Cari transaksi di tabel berdasarkan no_struk
      const { data: trxData } = await supabase
        .from('transaksi')
        .select('*')
        .eq('no_struk', order_id)
        .single();

      if (!trxData) return new Response("Transaksi tidak ditemukan", { status: 200 });

      const statusLama = trxData.status_pembayaran;

      // 2. Update Status Pembayaran Transaksi
      await supabase
        .from('transaksi')
        .update({ status_pembayaran: statusAkhir })
        .eq('no_struk', order_id);

      // 3. Catat ke Arus Kas jika status baru menjadi Lunas
      if (statusAkhir === "Lunas" && statusLama !== "Lunas" && statusLama !== "Sukses") {
        await supabase.from('arus_kas').insert([{
          klien_id: trxData.klien_id,
          tipe: "Penjualan",
          akun_asal: "Midtrans", 
          nominal: trxData.total_akhir, // Sesuaikan dengan nama kolom total di tabel Anda (uang_bayar/total_akhir)
          keterangan: "Penjualan Struk: " + order_id,
          kasir: trxData.kasir || "Sistem"
        }]);
      }

      return new Response("OK", { status: 200 });

    } catch (error: any) {
      console.error("Webhook Error:", error);
      return new Response("Error: " + error.message, { status: 500 });
    }
  }
};
