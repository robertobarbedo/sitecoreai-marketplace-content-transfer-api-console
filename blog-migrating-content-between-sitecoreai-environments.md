# Migrating Content Between SitecoreAI Environments with the Content Transfer API

If you've recently looked for the familiar **Installation Wizard** to move a
content package between environments, you already know: **Sitecore package
installation is decommissioned in SitecoreAI**. There is no Package Designer,
no `.zip` upload, no "Install package" button. Moving content between
environments now goes through two REST APIs — the **Content Transfer API**
and the **Item Transfer API**.

Calling those APIs by hand works, but it's a lot of curl for something you
used to do in a wizard. So I built a Sitecore Marketplace app that wraps the
whole workflow in a UI: the **Content Transfer Console**.

<!-- Screenshot: Content Transfer Console — main view with source/destination picker -->

## Why Two APIs?

Sitecore split the transfer into two halves, and understanding that split
makes everything else click:

- The **Content Transfer API** runs on your *source* environment. It
  snapshots the items you nominate into chunk sets, which you copy — chunk by
  chunk, as raw bytes — to the *destination* environment, where they become
  `.raif` files.
- The **Item Transfer API** runs on your *destination* environment. It
  consumes those `.raif` files into the target database.

💡 Different endpoints run against different environments. Getting that wrong
is the most common mistake when scripting this by hand, which is why the
console badges every action with the environment it runs on.

## Setting Up Connections

Each environment needs an **automation client** created in SitecoreAI Deploy
(*Credentials → Environment → Create credentials → Automation* — you must be
an Organization Admin or Owner). In the console you register each environment
once: a label, the environment host name, and the client ID and secret.

<!-- Screenshot: Environment connections dialog -->

No credential is shared or stored anywhere outside of your Sitecore instance
— connections live in the content tree, and tokens never leave the server.

## The Simple Path: Automatic Content Transfer

For the everyday case — "move this tree from QA to Production" — the
**Content Transfer** tab asks for exactly three things:

- A **content tree path**, with a tree picker browsing the source environment
- The **scope**: single item, or item and all descendants
- A **merge strategy**: override existing item, keep existing item, latest
  win, or override existing tree

Click **Start transfering** and the console does the rest: creates the
transfer, copies every chunk, generates the `.raif` files, consumes them into
the destination database, and cleans up after itself. A stage checklist shows
live progress.

<!-- Screenshot: Automatic Transfer — progress checklist mid-run -->

## The Full Control Path: The Advanced Tab

When you need multiple paths, a different database, or want to drive each API
call yourself, the **Advanced** tab exposes the workflow
step-by-step: create the transfer, copy and complete each chunk set, consume
each blob, retry failures, and clean up — each as an explicit action with its
own status. It's also where you can attach to a transfer by ID, which is
handy if an automatic run fails midway.

<!-- Screenshot: Advanced transfer — chunk sets table -->

There are also **Item transfers** and **History** tabs for inspecting every
consumption on the destination, down to the individual transferred item.

## TL;DR

- Sitecore package installation is gone in SitecoreAI — content moves via the
  Content Transfer API (source) and Item Transfer API (destination).
- Create one automation client per environment in SitecoreAI Deploy; that's
  all the setup the console needs.
- Use the **Content Transfer** tab for one-path, hands-off moves; use the
  **Advanced** tab when you need multiple paths, other databases, or
  step-by-step control.
- Chunk data must be forwarded byte-for-byte between environments — the
  console handles that server-side so you never have to think about it.
