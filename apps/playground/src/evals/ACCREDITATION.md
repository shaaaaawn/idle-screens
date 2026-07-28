# Accreditation — the artistic style evals

Every screen in this suite is an **original generative composition**. Nothing
here reproduces, copies, or contains any artwork. A SaverSpec is data — a
background plus layers of moving sprites — compiled by a seeded renderer. There
is no image anywhere in the pipeline.

What the suite does is measure whether that data format can carry a *style*: a
tempo, a palette, a way of making marks, a sense of depth. Those readings come
from studying particular artists, and the honest thing is to say whose.

## Why the channels aren't named after artists

Two different uses, deliberately kept apart.

**Naming an artist to describe an influence is descriptive use**, and it's what
makes the dataset legible — a row labelled *Georges Seurat* tells you exactly
what was asked for. That precision stays: `artistId` and `artist` are unchanged
throughout the eval code and the published dataset.

**A channel title on a commercial site is a different thing.** The exposure
there was never the composition — artistic style isn't protected by copyright,
and these aren't reproductions. It's the naming: right of publicity for living
artists, marks held by estates, and the implication that someone endorsed or
made this. So consumer surfaces use a descriptive title (`Infinity Field`) and
a channel id (`evals-infinity-field`) for **every** style, uniformly — including
the ones we could safely name. Uniform means no public surface depends on a
per-artist review flag being correct.

`publicNaming` on each profile controls one thing only: whether the artist may
*also* be credited by name on that surface. Never whether the work appears.

Suppressing a name on a product page is not the same as failing to credit an
influence. This file is the credit.

## The studies

| Study | Movement | After | Named on channels |
| --- | --- | --- | --- |
| Impressionist Light | Impressionism | Claude Monet (1840–1926) | yes |
| Turbulent Stroke | Post-Impressionism | Vincent van Gogh (1853–1890) | yes |
| Pointillist Field | Pointillism / Neo-Impressionism | Georges Seurat (1859–1891) | yes |
| Ukiyo-e Wave | Ukiyo-e | Katsushika Hokusai (1760–1849) | yes |
| Gold Tessera | Art Nouveau / Vienna Secession | Gustav Klimt (1862–1918) | yes |
| Abstract Counterpoint | Abstract / Bauhaus | Wassily Kandinsky (1866–1944) | yes |
| Primary Grid | De Stijl | Piet Mondrian (1872–1944) | yes |
| Suprematist Plane | Suprematism | Kazimir Malevich (1879–1935) | yes |
| Analytic Facets | Cubism | Pablo Picasso (1881–1973) | no |
| Deadpan Surreal | Surrealism | René Magritte (1898–1967) | no |
| Color Field | Colour Field / Abstract Expressionism | Mark Rothko (1903–1970) | no |
| Magnified Bloom | American Modernism | Georgia O'Keeffe (1887–1986) | no |
| Neo-Expressive Scrawl | Neo-Expressionism | Jean-Michel Basquiat (1960–1988) | no |
| Infinity Field | Contemporary | Yayoi Kusama (b. 1929) | no |
| Optical Pulse | Op Art | Bridget Riley (b. 1931) | no |

The right-hand column reflects term status and nothing else — it is not a
ranking of influence, and it says nothing about any artist or their work.

## Screen titles

Signature screens are titled by **composition**, not by artwork. Where a title
previously named a specific painting by an artist whose work is still in
copyright, it was renamed at the source (`artists.ts`) rather than masked
downstream — so no export, dataset, or channel can carry it.

Titles that name public-domain works are unchanged.

## No affiliation

Nothing here is affiliated with, endorsed by, or produced in cooperation with
any artist, estate, foundation, or rights body. Every artist name in this
repository appears to describe the influence on a study, and for no other
purpose.

---

Policy: `idle-mono/docs/eval-publishing-spec.md` §5. Mechanism:
[`public-identity.ts`](./public-identity.ts).
