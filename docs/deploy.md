# Vercel Deployment Guide

## Using Topic Analyzer Admin from localhost

The Topic Analyzer buttons call `/api/analyze-topics`, which is a **Vercel serverless function**. On localhost, Vite does not run that API, so requests would fail with "Unexpected end of JSON input".

**Fix:** The dev server is configured to proxy `/api` to your Vercel deployment. Restart the dev server after pulling:

```bash
npm run dev
```

Then use the app at http://localhost:5173 as usual; API calls go to Vercel.

**Alternative:** Run the full stack locally (frontend + API) with:

```bash
vercel dev
```

---

## Environment Variables Required

Before deploying, make sure to set these in Vercel:

1. `VITE_SUPABASE_URL` - Your Supabase project URL
   - Example: `https://iktqpjwoahqycvlmstvx.supabase.co`

2. `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous/public key
   - Get this from: Supabase Dashboard → Settings → API → Project API keys → anon/public

## Deployment Steps

### Option 1: Deploy via Vercel CLI
```bash
vercel
```

### Option 2: Deploy via Vercel Dashboard
1. Push your code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

## After Deployment

Set environment variables in Vercel Dashboard:
- Go to your project → Settings → Environment Variables
- Add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Redeploy if needed
