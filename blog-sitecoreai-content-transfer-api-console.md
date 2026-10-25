# SitecoreAI Content Transfer API Console

Moving content between SitecoreAI environments is done through two REST APIs
— the **Content Transfer API** on the source environment and the **Item
Transfer API** on the destination. They're well documented, but the workflow
spans a dozen endpoints across two hosts, with binary chunk streaming in the
middle. That's a lot to script every time you need to push a content tree
from QA to Production.

The **Content Transfer Console** is a Sitecore Marketplace app that wraps the
entire workflow in a UI. Pick a source, pick a destination, pick a path —
and let the console drive the APIs for you.

<!-- Screenshot: Content Transfer Console — main view -->

## One Console, Two Modes

### Quick Transfer

The default tab covers the everyday case. It asks for three things:

- A **content tree path** — paste it, or browse the source environment with
  the built-in tree picker
- The **scope**: single item, or item and all descendants
- A **merge strategy**: override existing item, keep existing item, latest
  win, or override existing tree

Click **Start migration** and everything else is automatic: the transfer is
created on the source, every chunk is copied to the destination, the `.raif`
files are generated and consumed into the target database, and the temporary
resources are cleaned up at the end. A live checklist shows each stage as it
runs, and you can cancel at any point.

<!-- Screenshot: Quick Transfer tab — progress checklist mid-run -->

💡 If a run fails midway, the transfer ID is kept in your recent transfers so
you can pick it up in the Advanced tab — nothing is lost.

### Advanced

The **Advanced** tab exposes the same workflow step by step, for when you
need more than one path, a different database, or full control over each API
call:

1. **Create** a transfer with multiple data trees, each with its own scope
   and merge strategy
2. **Copy chunk sets** to the destination, with per-chunk progress, resume
   on failure, and even single-chunk recovery
3. **Consume** each `.raif` blob into the database of your choice, with live
   monitoring and retry for failures
4. **Clean up** the transfer operation and discard consumed blobs

Every action is badged with the environment it runs on — source or
destination — because that's the easiest thing to get wrong when working
with these APIs directly.

<!-- Screenshot: Advanced tab — chunk sets table with copy progress -->

## Saved Transfers

Most transfers aren't one-offs — you push the same content trees from the
same source to the same destination, release after release. The **Saved
Transfers** tab turns that routine into a stored definition: a name, a
source/destination pair, and any number of data trees, each with its own
scope and merge strategy.

Definitions are stored in the Sitecore content tree next to the environment
connections, so the whole team shares the same list. When it's time to
deploy, one click runs the saved transfer through the same automatic
pipeline as Quick Transfer — full progress checklist included.

Each saved transfer can also opt in to **Reconcile at the end**: once the
content lands on the destination, the console applies that environment's
desired values on top (more on that below). Transfer and fix-up in a single
run.

<!-- Screenshot: Saved Transfers tab — list of definitions with Run buttons -->

## Reconciliation

Transferring content between environments has a classic side effect: items
that are *supposed* to differ per environment — API keys, hostnames,
feature toggles — get overwritten with the source's values. The
**Reconciliation** tab closes that gap.

It integrates with the **Content Reconciliation** Marketplace app
<!-- TODO: link to the Content Reconciliation blog post -->, where you
define the desired per-environment values. The console reads those
definitions and renders a preview: every item and field that deviates from
what that environment should contain, side by side with the value it will
get. Apply the plan and the destination is patched back to its intended
state.

Defining and maintaining the desired values happens in the Content
Reconciliation app itself — I'll cover that in an upcoming post
<!-- TODO: replace with link to the reconciliation tool blog post -->. The
console is the consumer: it checks each environment for the app's
configuration, tells you if it isn't set up yet, and otherwise gives you
preview-and-apply right where the transfers happen.

<!-- Screenshot: Reconciliation tab — preview of planned changes -->

## Visibility Included

Two more tabs cover the "what happened?" questions:

- **Transfer Details History** lists every consumption on the destination,
  with item counts, validation errors, and a drill-down to each transferred
  item
- **Transfer Timeline** shows the full state-transition timeline of every
  consumed source, newest first

<!-- Screenshot: Transfer Timeline tab with an expanded timeline -->

## Under the Hood

A few design choices worth knowing:

- **Credentials never leave your instance.** Environment connections are
  stored in the Sitecore content tree, and all API calls go through the
  app's own server-side routes — the browser never talks to the Sitecore
  APIs or the token endpoint directly.
- **Chunks are forwarded byte-for-byte.** The Content Transfer API requires
  chunk data to arrive exactly as it left the source (media compressed,
  content encrypted). The console copies chunks server-side, so the binary
  payload never touches the browser.
- **Tokens are cached and refreshed automatically**, including the API's
  quirk of reporting an expired JWT as `403 Forbidden`.

## How to Set Up

<!-- TODO: setup instructions -->

## TL;DR

- The Content Transfer Console is a Marketplace app that wraps the SitecoreAI
  Content Transfer and Item Transfer APIs in one UI.
- Use the **Quick Transfer** tab for hands-off, one-path transfers with a
  live progress checklist.
- Use **Saved Transfers** to store recurring multi-tree transfers and run
  them in one click — optionally reconciling the destination at the end.
- The **Reconciliation** tab previews and re-applies each environment's
  desired values after a transfer, powered by the Content Reconciliation app
  <!-- TODO: link to the reconciliation tool blog post -->.
- Use the **Advanced** tab for multiple paths, other databases, retries, and
  step-by-step control.
- The **Transfer Details History** and **Transfer Timeline** tabs answer
  "did it work?" down to the individual item.
