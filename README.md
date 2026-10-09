# Connectify

Online phone shop for Connectify (Lebanon), WhatsApp +961 71 062 768.

- `index.html` is the whole store and the owner admin (Admin link in the footer).
- `img/` holds product photos (`ph` full size, `pht` thumbnails, `cx` Connectify photos, `phones` phone photos).
- Orders, stock, prices and the admin login run on Supabase. `supabase/connectify-setup.sql` creates the tables and security rules.
- The site only contains the public (publishable) Supabase key. Never commit the secret key.

## Deploy
Static site: no build step. Serve the repo root (GitHub Pages, Netlify, Vercel, any host).
