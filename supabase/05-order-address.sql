-- Connectify update 5: delivery address on orders (and in the order email)
-- Paste into Supabase > SQL Editor > New query, then click RUN. Safe to run more than once.

alter table public.orders add column if not exists address text check (address is null or char_length(address) <= 300);

-- builds and sends the email (runs in the background, never slows down or blocks the order)
create or replace function public.send_order_alert(o public.orders)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  api_key text; to_email text; rows_html text := ''; total numeric := 0; has_ask boolean := false;
  it jsonb; wa text; subject text; body text; kind text;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  select decrypted_secret into to_email from vault.decrypted_secrets where name = 'order_alert_email' limit 1;
  if api_key is null or to_email is null then return; end if;

  kind := case when o.type = 'tradein' then 'Trade-in request' else 'Order' end;

  -- WhatsApp link for the customer's number (Lebanese numbers get +961)
  wa := regexp_replace(coalesce(o.phone,''), '\D', '', 'g');
  if wa like '00%' then wa := substr(wa,3); end if;
  if wa like '0%' then wa := substr(wa,2); end if;
  if length(wa) between 7 and 8 then wa := '961' || wa; end if;

  if o.type = 'tradein' then
    rows_html := '<tr><td style="padding:8px 0"><b>' || _h(o.trade->>'title') || '</b><br><span style="color:#667">'
      || _h(o.trade->>'detail') || '</span></td><td style="padding:8px 0;text-align:right;white-space:nowrap">'
      || _h(o.trade->>'est') || '</td></tr>';
  else
    for it in select * from jsonb_array_elements(coalesce(o.items,'[]'::jsonb)) loop
      rows_html := rows_html || '<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>' || _h(it->>'title')
        || '</b><br><span style="color:#667">' || _h(it->>'detail') || '</span></td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">'
        || case when it->>'price' is null then 'Price on WhatsApp' else '$' || (it->>'price') end || '</td></tr>';
      if it->>'price' is null then has_ask := true; else total := total + (it->>'price')::numeric; end if;
    end loop;
    if total > 0 then
      rows_html := rows_html || '<tr><td style="padding:10px 0"><b>Total</b>' || case when has_ask then ' <span style="color:#667">(+ items priced on WhatsApp)</span>' else '' end
        || '</td><td style="padding:10px 0;text-align:right"><b>$' || total || '</b></td></tr>';
    end if;
  end if;

  subject := '🛎️ New ' || lower(kind) || ' ' || o.code || ' from ' || o.name;
  body := '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">'
    || '<h2 style="margin:0 0 4px">New ' || lower(kind) || ' ' || _h(o.code) || '</h2>'
    || '<p style="color:#667;margin:0 0 16px">' || to_char(o.created_at at time zone 'Asia/Beirut','FMDay DD Mon, HH12:MI AM') || ' (Beirut)</p>'
    || '<p style="margin:0 0 6px"><b>' || _h(o.name) || '</b> · ' || _h(o.phone) || coalesce(' · ' || _h(nullif(o.area,'')),'') || '</p>'
    || coalesce('<p style="margin:0 0 6px">📍 ' || replace(_h(nullif(coalesce(o.address,o.trade->>'address'),'')),chr(10),'<br>') || '</p>','')
    || coalesce('<p style="margin:0 0 16px;color:#667">' || _h(nullif(o.pay,'')) || '</p>','')
    || '<p style="margin:0 0 18px"><a href="https://wa.me/' || wa || '" style="background:#25D366;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none;font-weight:bold">Reply on WhatsApp</a></p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">' || rows_html || '</table>'
    || '<p style="margin-top:22px;color:#667;font-size:13px">Open the store admin to confirm it and mark it delivered.</p></div>';

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization','Bearer ' || api_key,'Content-Type','application/json'),
    body := jsonb_build_object('from','Connectify Orders <onboarding@resend.dev>','to',jsonb_build_array(to_email),'subject',subject,'html',body)
  );
exception when others then
  raise warning 'order alert not sent: %', sqlerrm;   -- an email problem never blocks the order
end $$;

select 'address column ready' as result;
