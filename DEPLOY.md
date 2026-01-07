# Deploy to solnadocash.com

## Option 1: Vercel (Recommended)

### Step 1: Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/solnadocash.git
git push -u origin main
```

### Step 2: Deploy to Vercel
1. Go to https://vercel.com
2. Click "Add New Project"
3. Import your GitHub repository
4. Add environment variables:
   - `RPC_URL` = `https://api.mainnet-beta.solana.com` (or your RPC)
5. Click Deploy

### Step 3: Connect Domain
1. In Vercel dashboard, go to your project
2. Click "Settings" → "Domains"
3. Add `solnadocash.com`
4. Update your DNS:
   - Add CNAME record: `@` → `cname.vercel-dns.com`
   - Or A record: `@` → `76.76.21.21`

---

## Option 2: Railway

### Step 1: Deploy
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Step 2: Add Domain
1. In Railway dashboard, go to Settings
2. Add custom domain: `solnadocash.com`
3. Update DNS as instructed

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | No | Solana RPC endpoint (default: mainnet) |
| `PORT` | No | Server port (default: 3000) |

---

## DNS Settings for solnadocash.com

Add these records in your domain registrar:

### For Vercel:
```
Type: CNAME
Name: @
Value: cname.vercel-dns.com
```

### Or A Record:
```
Type: A
Name: @
Value: 76.76.21.21
```

### For www subdomain:
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
```

