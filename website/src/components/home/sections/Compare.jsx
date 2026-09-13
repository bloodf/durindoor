import { COMPARISON } from "../content.js";
import Icon from "../ui/Icon.jsx";
import { Reveal, SectionHeader } from "../ui/primitives.jsx";

// Real <table> on wide screens; below 700px the CSS turns each row into a card
// and the `data-label` attributes provide the column names.
export default function Compare() {
  return (
    <section id="compare" className="section section-compare" aria-labelledby="compare-title">
      <div className="container">
        <SectionHeader
          eyebrow="Before and after"
          title={<span id="compare-title">Wiring every tool by hand, or one door</span>}
          lead="What changes when your tools stop talking to providers directly."
        />
        <Reveal className="compare-frame">
          <table className="compare">
            <caption className="sr-only">Per-tool provider setup compared with DurinDoor</caption>
            <thead>
              <tr>
                <th scope="col">When you need</th>
                <th scope="col">Per-tool setup</th>
                <th scope="col" className="is-door">
                  DurinDoor
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.need}>
                  <th scope="row">{row.need}</th>
                  <td data-label="Per-tool setup" className="is-diy">
                    <span className="compare-mark is-no" aria-hidden="true" />
                    {row.diy}
                  </td>
                  <td data-label="DurinDoor" className="is-door">
                    <span className="compare-mark is-yes" aria-hidden="true">
                      <Icon name="check" size={14} />
                    </span>
                    {row.door}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
      </div>
    </section>
  );
}
