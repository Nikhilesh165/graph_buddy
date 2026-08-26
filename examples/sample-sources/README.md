# Example data sources

Five files, one for each format Graph Buddy's MVP ingests (PDF/DOCX/CSV/TXT/MD),
all describing the same fictional startup, **Solstice Robotics**. They share
people, projects, customers, and locations across files on purpose, so that
uploading all five gives the ontology bootstrap and extraction pipeline real
cross-document entities to resolve (e.g. "Priya Nair" and "GreenField Farms"
each show up in three different sources) rather than five disconnected blobs.

| File                      | Format | What it is                                             |
|---------------------------|--------|---------------------------------------------------------|
| `employees.csv`           | CSV    | Headcount roster: name, role, department, manager, location |
| `meeting_notes.txt`       | TXT    | Raw notes from a product sync, with action items         |
| `project_overview.md`     | MD     | Product/project docs, including a customer table          |
| `company_handbook.docx`   | DOCX   | Org structure, locations, and HR policy                   |
| `quarterly_report.pdf`    | PDF    | Investor update: headcount, project status, financing      |

## Using them

Upload all five through the Sources panel (or `POST /sources`) to exercise the
full pipeline end to end: per-type parsing, the LLM ontology-bootstrap pass,
and ontology-guided extraction into Graphiti. Because the same entities recur
(e.g. Priya Nair leads Project Meridian in the Markdown doc, is in the CSV
roster, and appears again in the meeting notes and PDF), the resulting graph
should show multiple sources contributing to the same nodes -- a good way to
sanity-check entity resolution and the Retrieval Inspector's per-answer
source attribution.

## Regenerating

`employees.csv`, `meeting_notes.txt`, and `project_overview.md` are plain text
and checked in directly -- edit them like any other text file. The two binary
formats are produced by a small script using the backend's own dependencies
(`python-docx`, `fpdf2`):

```sh
cd backend
uv run python ../examples/sample-sources/generate_binary_samples.py
```

This overwrites `company_handbook.docx` and `quarterly_report.pdf` in place.
