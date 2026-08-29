import { Icons } from '../components/icons';
import { useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';

// System Settings — Administrator only.
//
// The route is guarded by ProtectedRoute (moduleId 'settings', which only
// ROLES.badac_admin lists) and the sidebar only renders the entry for the same
// role. NEITHER of those is the security boundary: every endpoint this page
// calls — GET/PUT /settings, POST/PUT /crime-types — carries
// role:badac_admin middleware server-side, so a non-administrator who calls
// them directly is refused with a 403 whether or not they ever saw this page.
export default function Settings() {
  const { settings, saveSettings, crimeTypes, addCrimeType, updateCrimeType } =
    useData();
  const { showToast } = useToast();

  const [newCategory, setNewCategory] = useState('');
  const [threshold, setThreshold] = useState(settings.threshold ?? 5);
  const [hotspotThreshold, setHotspotThreshold] = useState(
    settings.hotspotThreshold ?? 3,
  );
  const [population, setPopulation] = useState(settings.population ?? 15000);
  const [newCrimeType, setNewCrimeType] = useState('');
  const [savingCrimeType, setSavingCrimeType] = useState(false);
  // id of the crime type currently being toggled/recoloured, so only that
  // row's controls disable while its request is in flight.
  const [busyCrimeTypeId, setBusyCrimeTypeId] = useState(null);

  const categories = settings.categories || [];

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    if (categories.includes(name)) {
      showToast('Category already exists', 'error');
      return;
    }
    try {
      await saveSettings({ categories: [...categories, name] });
      setNewCategory('');
      showToast('Category added', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save category', 'error');
    }
  };

  const removeCategory = async (cat) => {
    try {
      await saveSettings({ categories: categories.filter((c) => c !== cat) });
      showToast('Category removed', 'success');
    } catch (err) {
      showToast(err.message || 'Could not remove category', 'error');
    }
  };

  // No colour is chosen here. The server assigns one from a curated palette,
  // skipping every colour already in use — which is the point: adding "Rape"
  // must not require anybody to think about, or edit, a colour.
  const handleAddCrimeType = async () => {
    const name = newCrimeType.trim();
    if (!name || savingCrimeType) return;
    setSavingCrimeType(true);
    try {
      const created = await addCrimeType(name);
      setNewCrimeType('');
      showToast(
        `Crime type "${created.name}" added and assigned a map colour`,
        'success',
      );
    } catch (err) {
      showToast(err.message || 'Could not add crime type', 'error');
    } finally {
      setSavingCrimeType(false);
    }
  };

  const handleToggleCrimeType = async (type) => {
    setBusyCrimeTypeId(type.id);
    try {
      await updateCrimeType(type.id, { isActive: !type.isActive });
      showToast(
        `"${type.name}" ${type.isActive ? 'disabled' : 'enabled'}`,
        'success',
      );
    } catch (err) {
      showToast(err.message || 'Could not update crime type', 'error');
    } finally {
      setBusyCrimeTypeId(null);
    }
  };

  // Recolouring is deliberately possible but never automatic: an existing
  // crime type keeps its assigned colour forever unless an Administrator
  // changes it here, and the change is written to the audit log.
  const handleColorChange = async (type, color) => {
    if (color.toUpperCase() === type.color.toUpperCase()) return;
    setBusyCrimeTypeId(type.id);
    try {
      await updateCrimeType(type.id, { color });
      showToast(`Map colour updated for "${type.name}"`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not update map colour', 'error');
    } finally {
      setBusyCrimeTypeId(null);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await saveSettings({
        threshold: parseFloat(threshold) || 5,
        hotspotThreshold: parseInt(hotspotThreshold, 10) || 3,
        population: parseInt(population, 10) || 15000,
      });
      showToast('Settings saved successfully', 'success');
    } catch (err) {
      showToast(err.message || 'Could not save settings', 'error');
    }
  };

  return (
    <section className="module">
      <div className="settings-grid">
        {/* Crime Types & Map Colours — the vocabulary the incident form, every
            crime-type filter and the Crime Mapping legend are built from. */}
        <Card title="Crime Types &amp; Map Colours">
          <p className="settings-note">
            Crime types drive the incident form, every crime type filter, and
            the colours on Crime Mapping. A new crime type is assigned an unused
            map colour automatically; that colour then stays with it permanently
            unless changed here.
          </p>

          <div className="crime-type-list">
            {crimeTypes.length === 0 && (
              <div className="settings-empty">No crime types configured.</div>
            )}
            {crimeTypes.map((type) => (
              <div
                className={`crime-type-row ${type.isActive ? '' : 'disabled'}`}
                key={type.id}
              >
                {/* A real colour input, so the assigned colour is both VIEWED
                    and adjustable in the same control. onBlur rather than
                    onChange: a native colour picker fires continuously while
                    the cursor is dragged, which would be one PUT per pixel. */}
                <input
                  type="color"
                  className="crime-type-color"
                  defaultValue={type.color}
                  disabled={busyCrimeTypeId === type.id}
                  onBlur={(e) => handleColorChange(type, e.target.value)}
                  aria-label={`Map colour for ${type.name}`}
                  title={`Map colour for ${type.name} (${type.color})`}
                />
                <span className="crime-type-name">{type.name}</span>
                <span className="crime-type-hex">{type.color}</span>
                <button
                  type="button"
                  className="crime-type-toggle"
                  disabled={busyCrimeTypeId === type.id}
                  onClick={() => handleToggleCrimeType(type)}
                  title={
                    type.isActive
                      ? 'Disable — hides it from new records, keeps existing ones'
                      : 'Enable'
                  }
                >
                  {type.isActive ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>

          <div className="settings-add">
            <input
              type="text"
              placeholder="New crime type name"
              value={newCrimeType}
              onChange={(e) => setNewCrimeType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCrimeType();
              }}
            />
            <Button
              size="sm"
              onClick={handleAddCrimeType}
              disabled={savingCrimeType}
            >
              {savingCrimeType ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <p className="settings-note">
            Disabling a crime type removes it from the pickers for new records.
            Existing incidents that already use it keep their crime type and
            their colour on the map.
          </p>
        </Card>

        <Card title="Crime Categories">
          <div id="categories-list">
            {categories.map((cat) => (
              <span className="category-tag" key={cat}>
                {cat}
                <button onClick={() => removeCategory(cat)}>&times;</button>
              </span>
            ))}
          </div>
          <div className="settings-add">
            <input
              type="text"
              placeholder="New category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCategory();
              }}
            />
            <Button size="sm" onClick={addCategory}>
              Add
            </Button>
          </div>
        </Card>

        <Card title="General Settings">
          <div className="form-group">
            <label htmlFor="setting-crime-rate-threshold">
              Crime Rate Threshold (per 1000 pop)
            </label>
            <input
              id="setting-crime-rate-threshold"
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="setting-hotspot-threshold">
              Hotspot Alert Threshold
            </label>
            <input
              id="setting-hotspot-threshold"
              type="number"
              value={hotspotThreshold}
              onChange={(e) => setHotspotThreshold(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="setting-population">Barangay Population</label>
            <input
              id="setting-population"
              type="number"
              value={population}
              onChange={(e) => setPopulation(e.target.value)}
            />
          </div>
          <Button onClick={handleSaveSettings}>
            <Icons.Save size={15} strokeWidth={2} /> Save Settings
          </Button>
        </Card>
      </div>
    </section>
  );
}
