import { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { deletePrompt, getPrompts, savePrompt } from '../utils/desktopBridgeApi';

interface Prompt {
  name: string;
  content: string;
  file: string;
}

interface PromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PromptDialog({ isOpen, onClose }: PromptDialogProps) {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadPrompts();
    }
  }, [isOpen]);

  const loadPrompts = async () => {
    setLoading(true);
    try {
      const data = await getPrompts();
      setPrompts(data.prompts || []);
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setSelectedPrompt(null);
    setEditMode(true);
    setEditName('');
    setEditContent('');
  };

  const handleEdit = (prompt: Prompt) => {
    setSelectedPrompt(prompt);
    setEditMode(true);
    setEditName(prompt.name);
    setEditContent(prompt.content);
  };

  const handleSave = async () => {
    if (!editName.trim() || !editContent.trim()) return;

    try {
      await savePrompt({ name: editName, content: editContent });
      await loadPrompts();
      setEditMode(false);
      setSelectedPrompt(null);
    } catch (err) {
      console.error('Failed to save prompt:', err);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(t('prompt.confirmDelete', 'Are you sure you want to delete this prompt?'))) return;

    try {
      await deletePrompt(name);
      await loadPrompts();
      if (selectedPrompt?.name === name) {
        setSelectedPrompt(null);
      }
    } catch (err) {
      console.error('Failed to delete prompt:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="prompt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-dialog-header">
          <h3>{t('prompt.title', 'Prompt Management')}</h3>
          <button className="dialog-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="prompt-dialog-content">
          {!editMode ? (
            <>
              <div className="prompt-dialog-actions">
                <button className="btn-primary" onClick={handleCreate}>
                  <Plus size={16} />
                  {t('prompt.create', 'Create Prompt')}
                </button>
              </div>

              {loading ? (
                <div className="prompt-loading">{t('common.loading', 'Loading...')}</div>
              ) : prompts.length === 0 ? (
                <div className="prompt-empty">{t('prompt.empty', 'No prompts yet')}</div>
              ) : (
                <div className="prompt-list">
                  {prompts.map((prompt) => (
                    <div
                      key={prompt.name}
                      className={`prompt-item ${selectedPrompt?.name === prompt.name ? 'selected' : ''}`}
                      onClick={() => setSelectedPrompt(prompt)}
                    >
                      <div className="prompt-item-info">
                        <div className="prompt-item-name">{prompt.name}</div>
                        <div className="prompt-item-preview">
                          {prompt.content.substring(0, 100)}...
                        </div>
                      </div>
                      <div className="prompt-item-actions">
                        <button
                          className="icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(prompt);
                          }}
                          title={t('common.edit', 'Edit')}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="icon-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(prompt.name);
                          }}
                          title={t('common.delete', 'Delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="prompt-edit">
              <div className="prompt-edit-field">
                <label>{t('prompt.name', 'Name')}</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={t('prompt.namePlaceholder', 'Enter prompt name')}
                />
              </div>
              <div className="prompt-edit-field">
                <label>{t('prompt.content', 'Content')}</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder={t('prompt.contentPlaceholder', 'Enter prompt content')}
                  rows={10}
                />
              </div>
              <div className="prompt-edit-actions">
                <button className="btn-secondary" onClick={() => setEditMode(false)}>
                  {t('common.cancel', 'Cancel')}
                </button>
                <button className="btn-primary" onClick={handleSave}>
                  <Save size={16} />
                  {t('common.save', 'Save')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
