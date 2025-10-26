// supabase/functions/purge-deleted-players/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

serve(async (req) => {
  // CORS対応
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Supabaseクライアントの作成
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 30日経過した退会者データを削除
    const { data: deletedData, error: fetchError } = await supabaseClient
      .from("deleted_player_data")
      .select("*")
      .lt("scheduled_purge_at", new Date().toISOString());

    if (fetchError) throw fetchError;

    let deletedCount = 0;

    // 各データを削除
    for (const record of deletedData || []) {
      // プレイヤーの試合統計を削除
      const { error: statsError } = await supabaseClient
        .from("player_stats")
        .delete()
        .eq("player_id", record.player_id);

      if (statsError) console.error("Error deleting stats:", statsError);

      // 退会データを削除
      const { error: deleteError } = await supabaseClient
        .from("deleted_player_data")
        .delete()
        .eq("id", record.id);

      if (!deleteError) deletedCount++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
        message: `${deletedCount}件の退会者データを完全削除しました`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});

// デプロイコマンド:
// supabase functions deploy purge-deleted-players

// Cron設定（毎日午前3時に実行）:
// supabase functions deploy purge-deleted-players --schedule "0 3 * * *"
