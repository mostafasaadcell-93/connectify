-- Connectify update 4: email alert for every new order and trade-in request
-- Before running this: you saved 2 secrets in the Vault (see the steps in the chat):
--   resend_api_key   = your Resend API key (starts with re_)
--   order_alert_email = the email that should get the alerts (the one you signed up to Resend with)
-- Paste into Supabase > SQL Editor > New query, then click RUN. Safe to run more than once.

create extension if not exists pg_net;

-- small helper: make text safe inside the email
create or replace function public._h(t text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;')
$$;

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

create or replace function public.orders_after_insert_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.send_order_alert(new);
  return new;
end $$;

drop trigger if exists order_email_alert on public.orders;
create trigger order_email_alert after insert on public.orders
  for each row execute function public.orders_after_insert_alert();

-- nobody outside can call these directly
revoke all on function public.send_order_alert(public.orders) from public, anon, authenticated;
revoke all on function public.orders_after_insert_alert() from public, anon, authenticated;

-- Send yourself a test email right now (uses a pretend order, saves nothing):
select public.send_order_alert(row(0,'C-TEST','order',now(),'Test customer','70 123 456','Beirut','Cash on delivery','new',
  '[{"title":"iPhone 17 Pro","detail":"256GB, Cosmic Orange, New","price":1199},{"title":"Silicone case","detail":"iPhone 17 Pro, Black","price":null}]'::jsonb,
  null,false)::public.orders);

select 'alerts on: check your inbox (and spam) in a minute' as result;
