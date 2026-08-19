import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Tangani blokir CORS browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { total, pelanggan, klien_id } = await req.json()
    if (!klien_id) throw new Error("klien_id wajib dikirim!")

    // Koneksi ke Supabase (Otomatis menggunakan variabel lingkungan bawaan)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Ambil data pengaturan Midtrans
    const { data: pengaturan, error: errPengaturan } = await supabase
      .from('pengaturan')
      .select('midtransServerKey, midtransEnv')
      .eq('klien_id', klien_id)
      .single()

    if (errPengaturan || !pengaturan || !pengaturan.midtransServerKey) {
      throw new Error("Server Key Midtrans belum diatur oleh Owner!")
    }

    const apiUrl = pengaturan.midtransEnv === "production" 
      ? "https://app.midtrans.com/snap/v1/transactions" 
      : "https://app.sandbox.midtrans.com/snap/v1/transactions"

    const orderId = "TRX-" + new Date().getTime()
    
    const payload = {
      transaction_details: { order_id: orderId, gross_amount: Math.round(total) },
      customer_details: { first_name: pelanggan || "Pelanggan" }
    }

    // Tembak API Midtrans
    const authHeader = "Basic " + btoa(pengaturan.midtransServerKey + ":")
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload)
    })

    const dataMidtrans = await response.json()

    if (dataMidtrans.token) {
      return new Response(JSON.stringify({ token: dataMidtrans.token, order_id: orderId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } else {
      throw new Error(dataMidtrans.error_messages?.[0] || "Gagal mendapatkan token")
    }

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})