# Host Turmoil Resource Tracker for your clan

This guide puts the website on **Vercel** and its shared database on **Neon**. Your clan will open one website and sign in with Discord. The hosted app runs independently of your Windows computer.

Follow the steps in order. Keep the Vercel, Neon, and Discord pages open in separate browser tabs so you can return to copy the settings. Use the GitHub account that owns **Sedgy-code/Turmoil-Resource-Tracker**. Review the providers' current plans and usage limits when creating your accounts.

1. Open [vercel.com](https://vercel.com/) and select **Sign Up**. Choose **Continue with GitHub** and sign in to your GitHub account. If you already have a Vercel account, select **Log In**.

2. In the Vercel dashboard, select **Add New → Project** or **New Project**.

3. Find **Turmoil-Resource-Tracker** under the GitHub account **Sedgy-code** and select **Import**. If the repository is missing, select the GitHub configuration option, grant Vercel access to this repository, and return to the import page.

4. On the project setup screen, use these settings:

   | Field | What to choose |
   | --- | --- |
   | Project Name | `turmoil-resource-tracker`, or keep Vercel's suggested name if that name is unavailable. |
   | Framework Preset | **Next.js** |
   | Root Directory | Leave at the repository root. Keep the default empty value or `./`. |
   | Build and Output Settings | Keep the detected defaults. The build command is `npm run build`. |
   | Environment Variables | Leave empty for this first deployment. You will add them below. |

5. Select **Deploy** and wait until the deployment says **Ready**. Vercel imports the prepared application from the repository's default `main` branch. The first build can complete before Discord and the database are configured.

6. Open the Vercel project's **Settings → Domains**. Copy the assigned **production domain**. It may look like `turmoil-resource-tracker.vercel.app`; use the actual domain shown in your project. Write down its full address, starting with `https://`, with no slash at the end. For example:

   ```text
   https://your-project.vercel.app
   ```

   Your website will keep this production address across redeployments. You can use the assigned `.vercel.app` address for your clan; buying a domain is optional. Discord sign-in will become available after you finish configuring it.

7. Open [console.neon.tech](https://console.neon.tech/) in another tab. Create a Neon account or sign in.

8. In Neon, select **New Project** or **Create Project**. Name it **Turmoil Resource Tracker**, keep the default database settings, choose an available region, and create the project.

9. Open the Neon project and select **Connect**. In **Connect to your branch**, keep the default branch, compute, database, and database role selected. Keep **Connection pooling** switched on.

10. Locate the full PostgreSQL **connection string**. Its hostname includes `-pooler`. Leave this page open: you will copy the full value into Vercel as `DATABASE_URL` later. This value contains the database password, so keep it private. Preserve its SSL settings.

11. Open [Discord's Developer Portal](https://discord.com/developers/applications) in another tab and sign in to Discord.

12. Select **New Application**. Enter **Turmoil Resource Tracker**, accept the required terms, and select **Create**.

13. In the application's menu, select **OAuth2**. Find its **Client ID** and **Client Secret**. Use **Reset Secret** if needed to obtain a secret, completing Discord's account verification if prompted. Leave this page open so you can copy these values later. The Client Secret must stay private.

14. On that OAuth2 page, find **Redirects** and select **Add Redirect**. Paste the full website address from step 6 followed immediately by `/api/auth/callback`, then save the changes. For example, if your website address is `https://your-project.vercel.app`, enter:

    ```text
    https://your-project.vercel.app/api/auth/callback
    ```

    Replace `your-project.vercel.app` with your actual domain. The `https://` prefix and complete callback path must match exactly. A Discord bot is not required; the tracker requests the necessary sign-in permissions itself.

15. Open Discord on your computer. Select the **User Settings** gear beside your profile, open **Advanced**, and turn on **Developer Mode**.

16. Right-click the **Turmoil server icon** and select **Copy Server ID**. Write down this numeric ID; it will be `DISCORD_GUILD_ID`. Keep every digit.

17. Right-click **your own Discord username or profile** and select **Copy User ID**. Write down this numeric ID; it will be `INITIAL_ADMIN_DISCORD_ID`. This makes your account the initial tracker admin when you first sign in.

18. For your first setup, allow all members of the Turmoil server and leave `DISCORD_ROLE_ID` unset. If you want to require a specific Discord role as well, open **Server Settings → Roles**, copy that role's ID, and use it for the optional field in step 23.

19. Open the [latest source ZIP download](https://github.com/Sedgy-code/Turmoil-Resource-Tracker/archive/refs/heads/main.zip). This downloads the current application files, including the Windows key generator.

20. In Windows **Downloads**, right-click the downloaded ZIP, select **Extract All**, then **Extract**. Open the extracted **Turmoil-Resource-Tracker-main** folder. If another folder with the same name is inside it, open that too, until you can see **MAKE-APP-KEY.bat**.

21. Double-click **MAKE-APP-KEY.bat**. It uses Node.js on your computer to generate a new random 64-character key and copy it to your Windows clipboard. This is your `AUTH_SECRET`. Keep the generated key private. If the window says to copy it manually, copy the displayed key before continuing.

22. Return to your Vercel project and open **Settings → Environment Variables**. Add a variable named **AUTH_SECRET**, paste the key from your clipboard into its value field, select **Production only**, and save it. Save this same key securely for future deployments. Use Vercel's secret/sensitive option if offered.

23. Add each remaining setting from this table on the same Vercel page. For each one, enter the name exactly, paste the value without quotation marks, select **Production only**, and save it. Return to your Neon or Discord tabs when you need to copy a value.

    | Variable name | Value to enter |
    | --- | --- |
    | `APP_URL` | The full production website address from step 6, starting with `https://`, with no trailing slash or callback path. |
    | `DATABASE_URL` | The complete pooled PostgreSQL connection string from Neon's **Connect** page. |
    | `DISCORD_CLIENT_ID` | The Discord application's **Client ID** from its OAuth2 page. |
    | `DISCORD_CLIENT_SECRET` | The Discord application's **Client Secret** from its OAuth2 page. |
    | `DISCORD_GUILD_ID` | The Turmoil server ID from step 16. |
    | `INITIAL_ADMIN_DISCORD_ID` | Your own Discord user ID from step 17. Set this before your first tracker sign-in. |
    | `DEMO_MODE` | `false` |
    | `DISCORD_ROLE_ID` | Optional: the required role's ID. Skip this variable if all Turmoil server members should have access. |

    `DATABASE_URL`, `DISCORD_CLIENT_SECRET`, and `AUTH_SECRET` are private credentials. Paste them directly into Vercel and keep them out of GitHub files, screenshots, and chat. Leave `LOCAL_DATABASE_PATH` unset for hosting.

24. In Vercel, open your project's **Deployments** tab. Find the latest deployment marked **Production**, select its **…** menu, and select **Redeploy**.

25. Confirm **Redeploy to Production**, then wait for **Ready**. The new deployment uses the environment variables you just saved. Whenever you change a setting later, redeploy again to apply it.

26. Open **Settings → Deployment Protection** in the Vercel project. Find **Vercel Authentication**. If its scope is **All Deployments**, change it to **Standard Protection** and save. Standard Protection leaves your production domain accessible while keeping preview and deployment URLs protected. If your screen selects environments individually, keep Production outside Vercel Authentication's protected environments.

27. Open a **private/incognito browser window** and visit the production website address from step 6. You should see the Turmoil tracker with **Discord sign-in**. If a Vercel login page appears, recheck step 26 and confirm you are using the project's production domain.

28. Select **Continue with Discord**, sign in with your account, and authorize the application. Your account must belong to the configured Turmoil server and have the required role if you configured one.

29. Confirm you can see **Manage Members**. That verifies your account became the initial admin. The hosted tracker starts with real Discord members and an empty shared database; the local demo's sample members and resource values are separate.

30. Open **My Resources**, enter a small quantity, and select **Save resources**. Refresh the page and confirm that quantity remains saved. Open **Dashboard** and check that it appears in the clan total.

31. Ask one other clan member to open the same production address, sign in with their own Discord account, and save an entry. Check that the dashboard includes both members' contributions.

32. If you have a separate Discord account outside the Turmoil server, try signing in with it and confirm access is denied. If you configured a required role, also test an account without that role before sharing widely.

33. Share the **production website address from step 6** with your clan. Members only need their browser and Discord account. You can promote additional admins in **Manage Members**. Weekly entries stay in Neon across website redeployments.

The tracker uses each member's Turmoil server nickname and server avatar when available, with their global Discord profile as the fallback. Existing members pick up this profile when they next sign in or when their membership is rechecked while using the tracker (after five minutes). To refresh it immediately, sign out and sign in again. Resource boxes can be cleared while typing, and an empty box saves as zero.

In **My Resources**, members can also enter **Cost of summoning 5 skills** beneath Skill Tickets: enter a number between **150 and 200**, with up to **one decimal place** (for example, **175.5**). **Cost per mount summon**, beneath Mount Keys, must be between **37.5 and 50** and accepts decimals. The endpoints of both ranges are allowed. Both costs are required when saving; blanks and zero are rejected. You can still clear a cost box while typing. Other empty resource boxes save as zero. The dashboard adds each member's exact skill and mount summon calculations, then rounds the clan totals to the nearest whole number. Older entries with missing costs retain a notice until updated. These costs are saved for the selected week and included when you copy the previous week. Existing resources stay saved when this feature is deployed; there are no new environment variables to enter.

Eggs and pets use one field called **Total eggs/pets**. Add all your eggs to hatch and pets to merge together and enter that number. The dashboard and member table use the same combined total. Previously saved rarity quantities are added together automatically, so members do not have to re-enter their old weeks.

If you hit a problem, use these checks and then redeploy after correcting environment settings:

| What you see | What to check |
| --- | --- |
| A Vercel login page | Use the production domain from step 6 and check Deployment Protection in step 26. |
| Discord rejects the redirect | Match `APP_URL` plus `/api/auth/callback` exactly to the redirect saved in Discord. |
| Discord sign-in is not configured | Confirm `AUTH_SECRET` and every required variable are saved for **Production**, then redeploy. |
| Server or role access denied | Check the complete numeric server/role IDs and your account's server membership and roles. |
| Your account is not admin | Confirm your user ID was saved as `INITIAL_ADMIN_DISCORD_ID` before first sign-in. An existing admin can promote you. |
| Database error | Copy Neon's complete connection string again, confirm `DATABASE_URL` is saved for Production, and redeploy. |
| A demo configuration error | Set `DEMO_MODE=false` for Production and redeploy. |

The app creates its database tables automatically on first access. This setup requires no SQL or terminal commands. Advanced development and optional manual migration instructions are in [README.md](README.md).

Official references: [Vercel Git import](https://vercel.com/docs/git), [environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), [redeploying](https://vercel.com/docs/deployments/managing-deployments#redeploy-a-project), [Deployment Protection](https://vercel.com/docs/security/deployment-protection), and [Neon connections](https://neon.com/docs/connect/connect-from-any-app).
