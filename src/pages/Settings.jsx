import { Icons } from '../components/icons';
import { useRef, useState } from 'react';
import { useData } from '../hooks/useData';
import { useToast } from '../hooks/useToast';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { downloadFile, today } from '../utils/helpers';

export default function Settings() {
  const { settings, saveSettings } = useData();
  const { showToast } = useToast();

  const [newCategory, setNewCategory] = useState('');
  const [threshold, setThreshold] = useState(settings.threshold ?? 5);
  const [hotspotThreshold, setHotspotThreshold] = useState(
    settings.hotspotThreshold ?? 3,
  );
  const [population, setPopulation] = useState(settings.population ?? 15000);
  const fileInputRef = useRef(null);

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

  const handleBackup = () => {
    const backup = JSON.stringify(
      { settings, exportedAt: new Date().toISOString() },
      null,
      2,
    );
    downloadFile(backup, `brgy178_backup_${today()}.json`, 'application/json');
    showToast('Backup downloaded', 'success');
  };

  const handleRestoreClick = () => fileInputRef.current?.click();

  const handleRestoreFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Frontend-only prototype: restoring isn't wired to a persistence layer yet.
    showToast(
      'Restore requires a backend connection — not available in this frontend prototype.',
      'info',
    );
    e.target.value = '';
  };

  return (
    <section className="module">
      <div className="settings-grid">
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

        <Card title="System Settings">
          <div className="form-group">
            <label>Crime Rate Threshold (per 1000 pop)</label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Hotspot Alert Threshold</label>
            <input
              type="number"
              value={hotspotThreshold}
              onChange={(e) => setHotspotThreshold(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Barangay Population</label>
            <input
              type="number"
              value={population}
              onChange={(e) => setPopulation(e.target.value)}
            />
          </div>
          <Button onClick={handleSaveSettings}>
            <Icons.Save size={15} strokeWidth={2} /> Save Settings
          </Button>
        </Card>

        <Card title="Data Backup & Restore">
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              marginBottom: 12,
            }}
          >
            Export all system data as JSON backup or restore from a previous
            backup.
          </p>
          <div className="export-bar">
            <Button variant="secondary" onClick={handleBackup}>
              <Icons.Down size={15} strokeWidth={2} /> Download Backup
            </Button>
            <Button variant="secondary" onClick={handleRestoreClick}>
              <Icons.Up size={15} strokeWidth={2} /> Restore Backup
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              className="hidden"
              onChange={handleRestoreFile}
            />
          </div>
        </Card>

        <Card title="Database Maintenance">
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.85rem',
              marginBottom: 12,
            }}
          >
            Clear old audit logs, optimize storage, and reset sample data.
          </p>
          <div className="export-bar">
            <Button
              variant="secondary"
              onClick={() =>
                showToast(
                  'Audit logs older than 90 days will be cleared.',
                  'info',
                )
              }
            >
              <Icons.Archive size={15} strokeWidth={2} /> Clear Old Logs
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Reset sample data? This will restore the original mock dataset the next time the app loads.',
                  )
                ) {
                  showToast(
                    'Reset requires a backend connection — not available in this frontend prototype.',
                    'info',
                  );
                }
              }}
            >
              <Icons.Sync size={15} strokeWidth={2} /> Reset Sample Data
            </Button>
          </div>
        </Card>
      </div>
    </section>
  );
}
