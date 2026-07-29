'use client';

import { Check, Copy, KeyRound, Plus, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { CreatedApiKey } from '@giwapay/sdk';
import { Button, Card, Field, Input } from '@giwapay/ui';
import { giwaPayClient } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { useGiwaPayLocale } from './language-toggle';
import { ProgressiveDisclosure } from './progressive-disclosure';

export function ApiKeysPanel() {
  const ko = useGiwaPayLocale() === 'ko';
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey>();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const keys = useQuery({
    queryKey: ['dashboard', 'api-keys'],
    queryFn: () => giwaPayClient.listApiKeys(),
  });

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(undefined);
    try {
      const result = await giwaPayClient.createApiKey(name);
      setCreated(result);
      setName('');
      await keys.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create API key');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (
      !window.confirm(
        ko
          ? '이 API 키를 폐기할까요? 기존 연동이 즉시 중단됩니다.'
          : 'Revoke this API key? Existing integrations will stop working.',
      )
    ) {
      return;
    }
    setRevoking(id);
    setError(undefined);
    try {
      await giwaPayClient.revokeApiKey(id);
      await keys.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not revoke API key');
    } finally {
      setRevoking(undefined);
    }
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Bilingual ko="API 키" en="API keys" />
          </h1>
          <Bilingual
            as="div"
            ko="서버 연동을 위한 범위 제한 판매자 인증 정보를 만드세요."
            en="Create scoped merchant credentials for your server integration."
          />
        </div>
      </div>

      {created ? (
        <div className="secret-box" role="status" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{ko ? '지금 이 키를 복사하세요' : 'Copy this key now'}</strong>
            <button
              type="button"
              className="gp-button gp-button--ghost gp-button--sm"
              onClick={() => setCreated(undefined)}
              aria-label="Dismiss API key"
            >
              <X size={14} />
            </button>
          </div>
          <p className="gp-field-hint">
            {ko
              ? '한 번만 표시됩니다. 닫기 전에 서버의 시크릿 관리자에 저장하세요.'
              : 'Shown once. Store it in your server secret manager before closing this message.'}
          </p>
          <code className="secret-value">{created.key}</code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? (ko ? '복사됨' : 'Copied') : ko ? 'API 키 복사' : 'Copy API key'}
          </Button>
        </div>
      ) : null}

      <Card className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>
            <Bilingual ko="API 키 만들기" en="Create API key" />
          </h2>
        </div>
        <form className="panel-body" onSubmit={create}>
          <div className="form-grid">
            <Field
              label={ko ? '키 이름' : 'Key name'}
              htmlFor="api-key-name"
              hint={
                ko
                  ? '사용할 환경이나 서비스 이름을 입력하세요.'
                  : 'Name the environment or service that will use it.'
              }
              className="full"
            >
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={ko ? '프로덕션 결제 서버' : 'Production checkout server'}
                minLength={1}
                maxLength={80}
                required
              />
            </Field>
          </div>
          {error ? (
            <p className="gp-field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button type="submit" loading={creating}>
              <Plus size={14} /> {ko ? '키 만들기' : 'Create key'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="panel">
        <div className="panel-header">
          <h2>
            <Bilingual ko="활성 인증 정보" en="Active credentials" />
          </h2>
        </div>
        {keys.isLoading ? (
          <LoadingState />
        ) : keys.error ? (
          <div className="panel-body">
            <ErrorState error={keys.error} />
          </div>
        ) : keys.data?.length ? (
          <table className="data-table compact-table api-key-table">
            <thead>
              <tr>
                <th>{ko ? '이름' : 'Name'}</th>
                <th>{ko ? '상태' : 'Status'}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {keys.data.map((key) => (
                <tr key={key.id}>
                  <td>
                    <span className="table-primary">{key.name}</span>
                    <ProgressiveDisclosure
                      className="api-key-row-disclosure"
                      summary={ko ? '인증 정보 상세' : 'Credential details'}
                      description={ko ? '접두어와 사용 기록' : 'Prefix and usage history'}
                    >
                      <dl>
                        <div className="gp-definition-row">
                          <dt>{ko ? '접두어' : 'Prefix'}</dt>
                          <dd className="mono">{key.prefix}…</dd>
                        </div>
                        <div className="gp-definition-row">
                          <dt>{ko ? '생성' : 'Created'}</dt>
                          <dd>{formatDateTime(key.createdAt)}</dd>
                        </div>
                        <div className="gp-definition-row">
                          <dt>{ko ? '마지막 사용' : 'Last used'}</dt>
                          <dd>
                            {key.lastUsedAt
                              ? formatDateTime(key.lastUsedAt)
                              : ko
                                ? '사용 안 함'
                                : 'Never'}
                          </dd>
                        </div>
                      </dl>
                    </ProgressiveDisclosure>
                  </td>
                  <td>
                    <span
                      className={`gp-badge gp-badge--${key.lastUsedAt ? 'success' : 'neutral'}`}
                    >
                      {key.lastUsedAt ? (ko ? '사용됨' : 'Used') : ko ? '미사용' : 'Unused'}
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(key.id)}
                      loading={revoking === key.id}
                      aria-label={ko ? `${key.name} 폐기` : `Revoke ${key.name}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <KeyRound size={19} />
            </span>
            <h3>{ko ? 'API 키가 없습니다' : 'No API keys'}</h3>
            <p>
              {ko
                ? '서버 연동에 필요한 인증 정보만 만드세요.'
                : 'Create a credential only for a server-side integration.'}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
