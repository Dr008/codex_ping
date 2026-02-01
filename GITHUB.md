# Publishing to GitHub

## Step 1: Create Repository on GitHub

1. Go to https://github.com/new
2. Repository name: `codex-ping-extension` (or any name you prefer)
3. Description: "VSCode extension that automatically pings Codex API when rate limits reset"
4. Choose **Public** or **Private**
5. **DO NOT** initialize with README, .gitignore, or license (we already have them)
6. Click "Create repository"

## Step 2: Update Repository URL (if needed)

If your repository URL is different from `https://github.com/YasYar/codex-ping-extension.git`, update it in `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git"
}
```

## Step 3: Add Remote and Push

Run these commands in the `codex-ping-extension` directory:

```bash
# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Codex Ping extension v0.1.0"

# Add remote (replace with your actual repository URL)
git remote add origin https://github.com/YasYar/codex-ping-extension.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 4: Verify

- Check that all files are on GitHub
- Verify the repository URL in `package.json` matches your GitHub repository
- The repository is now ready for VSCode Marketplace publication
