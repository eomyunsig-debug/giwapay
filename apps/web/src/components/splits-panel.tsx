'use client';

import { Check, Copy, Plus, Split, Trash2, UserRoundPlus } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAddress, zeroHash, type Address, type Hex } from 'viem';
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';

import { GIWA_SEPOLIA_CHAIN_ID } from '@giwapay/chains';
import { deriveSplitId, merchantRegistryAbi } from '@giwapay/sdk';
import { Button, Card, Field, Input } from '@giwapay/ui';
import { MERCHANT_REGISTRY_ADDRESS } from '@/lib/config';
import { formatBasisPoints, shortAddress } from '@/lib/format';
import { ErrorState, LoadingState } from './async-state';
import { Bilingual } from './bilingual';
import { useGiwaPayLocale } from './language-toggle';
import { ProgressiveDisclosure } from './progressive-disclosure';

interface RecipientDraft {
  address: string;
  basisPoints: string;
}

interface OnchainSplit {
  splitId: Hex;
  recipients: readonly Address[];
  basisPoints: readonly number[];
  enabled: boolean;
}

const initialRecipients = (): RecipientDraft[] => [{ address: '', basisPoints: '10000' }];

export function SplitsPanel() {
  const ko = useGiwaPayLocale() === 'ko';
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: GIWA_SEPOLIA_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [label, setLabel] = useState('');
  const [recipients, setRecipients] = useState<RecipientDraft[]>(initialRecipients);
  const [submitting, setSubmitting] = useState(false);
  const [disabling, setDisabling] = useState<Hex>();
  const [copied, setCopied] = useState<Hex>();
  const [error, setError] = useState<string>();

  const splitId = useMemo(() => {
    if (!address || !label.trim()) return undefined;
    return deriveSplitId(address, label);
  }, [address, label]);

  const splits = useQuery({
    queryKey: ['merchant-splits', MERCHANT_REGISTRY_ADDRESS, address],
    enabled: Boolean(MERCHANT_REGISTRY_ADDRESS && address && publicClient),
    refetchInterval: 8_000,
    queryFn: async (): Promise<OnchainSplit[]> => {
      const registryAddress = MERCHANT_REGISTRY_ADDRESS;
      if (!registryAddress || !address || !publicClient) return [];
      const count = await publicClient.readContract({
        address: registryAddress,
        abi: merchantRegistryAbi,
        functionName: 'splitTemplateCount',
        args: [address],
      });
      const customIds = await Promise.all(
        Array.from({ length: Number(count) }, (_, index) =>
          publicClient.readContract({
            address: registryAddress,
            abi: merchantRegistryAbi,
            functionName: 'splitTemplateIdAt',
            args: [address, BigInt(index)],
          }),
        ),
      );
      const ids = [zeroHash, ...customIds];
      return Promise.all(
        ids.map(async (id) => {
          const [addresses, bps, enabled] = await publicClient.readContract({
            address: registryAddress,
            abi: merchantRegistryAbi,
            functionName: 'getSplitTemplate',
            args: [address, id],
          });
          return {
            splitId: id,
            recipients: addresses,
            basisPoints: bps.map(Number),
            enabled,
          };
        }),
      );
    },
  });

  const updateRecipient = (index: number, field: keyof RecipientDraft, value: string) => {
    setRecipients((current) =>
      current.map((recipient, recipientIndex) =>
        recipientIndex === index ? { ...recipient, [field]: value } : recipient,
      ),
    );
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if (!address || !publicClient || !MERCHANT_REGISTRY_ADDRESS || !splitId) {
      setError('Connect the merchant admin wallet and configure MerchantRegistry.');
      return;
    }
    if (
      recipients.length < 1 ||
      recipients.length > 8 ||
      recipients.some(
        (recipient) => !isAddress(recipient.address) || !/^[1-9]\d*$/.test(recipient.basisPoints),
      )
    ) {
      setError('Use 1–8 valid, non-zero recipients and basis-point values.');
      return;
    }
    const addresses = recipients.map((recipient) => recipient.address as Address);
    const bps = recipients.map((recipient) => Number(recipient.basisPoints));
    if (new Set(addresses.map((value) => value.toLowerCase())).size !== addresses.length) {
      setError('Split recipients must be unique.');
      return;
    }
    if (bps.reduce((sum, value) => sum + value, 0) !== 10_000) {
      setError('Basis points must total exactly 10,000.');
      return;
    }

    setSubmitting(true);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'createSplitTemplate',
        args: [splitId, addresses, bps],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== 'success') {
        throw new Error('Split creation reverted.');
      }
      const [verifiedRecipients, verifiedBps, enabled] = await publicClient.readContract({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'getSplitTemplate',
        args: [address, splitId],
      });
      if (
        !enabled ||
        verifiedRecipients.length !== addresses.length ||
        verifiedBps.reduce((sum, value) => sum + Number(value), 0) !== 10_000
      ) {
        throw new Error('Created split could not be verified onchain.');
      }
      setLabel('');
      setRecipients(initialRecipients());
      await splits.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Split creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const disable = async (id: Hex) => {
    if (
      !address ||
      !publicClient ||
      !MERCHANT_REGISTRY_ADDRESS ||
      !window.confirm('Permanently disable this split template?')
    ) {
      return;
    }
    setDisabling(id);
    setError(undefined);
    try {
      if (chainId !== GIWA_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: GIWA_SEPOLIA_CHAIN_ID });
      }
      const hash = await writeContractAsync({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'disableSplitTemplate',
        args: [id],
        chainId: GIWA_SEPOLIA_CHAIN_ID,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });
      if (receipt.status !== 'success') throw new Error('Split disable reverted.');
      const [, , enabled] = await publicClient.readContract({
        address: MERCHANT_REGISTRY_ADDRESS,
        abi: merchantRegistryAbi,
        functionName: 'getSplitTemplate',
        args: [address, id],
      });
      if (enabled) throw new Error('Split remains enabled onchain.');
      await splits.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not disable split');
    } finally {
      setDisabling(undefined);
    }
  };

  const copy = async (id: Hex) => {
    await navigator.clipboard.writeText(id);
    setCopied(id);
    window.setTimeout(() => setCopied(undefined), 1_500);
  };

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            <Bilingual ko="정산 분배" en="Settlement splits" />
          </h1>
          <p>
            {ko
              ? '각 정산의 수령인과 비율을 미리 정하세요.'
              : 'Choose who receives each settlement and in what proportion.'}
          </p>
        </div>
      </div>

      <ProgressiveDisclosure
        className="split-security-disclosure"
        summary={<Bilingual ko="분배 템플릿 보안" en="How split templates stay safe" />}
        description={
          <Bilingual
            ko="수령인은 청구서 발행 전에 온체인에 고정됩니다."
            en="Recipients are fixed onchain before an invoice is issued."
          />
        }
      >
        <p className="gp-field-hint">
          {ko
            ? '청구서 서명자는 등록된 분배 ID만 참조할 수 있습니다. 임의의 수령인을 넣을 수 없으므로 서명 키가 노출돼도 정산 자금을 다른 곳으로 돌릴 수 없습니다.'
            : 'The invoice signer can only reference a registered split ID. It cannot provide arbitrary recipients, so a compromised invoice signer cannot redirect settlement funds.'}
        </p>
      </ProgressiveDisclosure>

      <Card className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>
            <Bilingual ko="분배 템플릿 만들기" en="Create split template" />
          </h2>
          <span className="metric-caption">1–8 recipients · total 100%</span>
        </div>
        <form className="panel-body" onSubmit={create}>
          <Field
            label={ko ? '분배 이름' : 'Split label'}
            htmlFor="split-label"
            hint={
              ko
                ? '팀이 알아볼 수 있는 고정된 이름을 사용하세요.'
                : 'Use a stable name your team will recognize.'
            }
          >
            <Input
              id="split-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="studio-revenue-v1"
              maxLength={100}
              required
            />
          </Field>
          {splitId ? (
            <ProgressiveDisclosure
              className="split-id-disclosure"
              summary={<Bilingual ko="생성될 분배 ID" en="Generated split ID" />}
              description={
                <Bilingual
                  ko="고급 연동에서 사용하는 변경 불가 식별자"
                  en="Immutable identifier for advanced integrations"
                />
              }
            >
              <code className="secret-value">{splitId}</code>
              <p className="gp-field-hint">
                {ko
                  ? '이름과 판매자 관리자 주소에서 계산됩니다. 만든 뒤에는 덮어쓸 수 없습니다.'
                  : 'Derived from the label and merchant admin address. Once created, this template cannot be overwritten.'}
              </p>
            </ProgressiveDisclosure>
          ) : null}

          <div className="step-list">
            {recipients.map((recipient, index) => (
              <div className="step-row" key={index}>
                <span className="step-number">{index + 1}</span>
                <div className="form-grid">
                  <Input
                    aria-label={`Recipient ${index + 1} address`}
                    className="mono"
                    value={recipient.address}
                    onChange={(event) => updateRecipient(index, 'address', event.target.value)}
                    placeholder="0x… recipient"
                    required
                  />
                  <Input
                    aria-label={`Recipient ${index + 1} basis points`}
                    inputMode="numeric"
                    value={recipient.basisPoints}
                    onChange={(event) => updateRecipient(index, 'basisPoints', event.target.value)}
                    placeholder="10000"
                    required
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={recipients.length === 1}
                  onClick={() =>
                    setRecipients((current) =>
                      current.filter((_, recipientIndex) => recipientIndex !== index),
                    )
                  }
                  aria-label={`Remove recipient ${index + 1}`}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>

          <div className="form-actions" style={{ justifyContent: 'space-between' }}>
            <Button
              variant="secondary"
              onClick={() =>
                setRecipients((current) =>
                  current.length >= 8 ? current : [...current, { address: '', basisPoints: '' }],
                )
              }
              disabled={recipients.length >= 8}
            >
              <UserRoundPlus size={14} /> {ko ? '수령인 추가' : 'Add recipient'}
            </Button>
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              disabled={!MERCHANT_REGISTRY_ADDRESS || !address}
            >
              <Plus size={15} /> {ko ? '온체인에 만들기' : 'Create onchain'}
            </Button>
          </div>
          {error ? (
            <p className="gp-field-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Card>

      <Card className="panel">
        <div className="panel-header">
          <h2>
            <Bilingual ko="온체인 템플릿" en="Onchain templates" />
          </h2>
        </div>
        {splits.isLoading ? (
          <LoadingState label="Reading split templates onchain…" />
        ) : splits.error ? (
          <div className="panel-body">
            <ErrorState error={splits.error} />
          </div>
        ) : splits.data?.length ? (
          <table className="data-table split-table">
            <thead>
              <tr>
                <th>{ko ? '분배' : 'Split'}</th>
                <th>{ko ? '수령인' : 'Recipients'}</th>
                <th>{ko ? '합계' : 'Total'}</th>
                <th>{ko ? '상태' : 'Status'}</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {splits.data.map((split) => (
                <tr key={split.splitId}>
                  <td>
                    <span className="table-primary">
                      {split.splitId === zeroHash
                        ? ko
                          ? '기본 지급'
                          : 'Default payout'
                        : ko
                          ? '사용자 분배'
                          : 'Custom immutable'}
                    </span>
                    <ProgressiveDisclosure
                      className="split-row-disclosure"
                      summary={ko ? '분배 상세' : 'Split details'}
                      description={ko ? 'ID와 레지스트리 출처' : 'ID and registry source'}
                    >
                      <code className="secret-value">{split.splitId}</code>
                      <p className="gp-field-hint">
                        {ko
                          ? '온체인 MerchantRegistry에서 직접 읽었습니다.'
                          : 'Read directly from the onchain MerchantRegistry.'}
                      </p>
                      <Button variant="secondary" size="sm" onClick={() => copy(split.splitId)}>
                        {copied === split.splitId ? <Check size={13} /> : <Copy size={13} />}
                        {copied === split.splitId
                          ? ko
                            ? '복사됨'
                            : 'Copied'
                          : ko
                            ? '분배 ID 복사'
                            : 'Copy split ID'}
                      </Button>
                    </ProgressiveDisclosure>
                  </td>
                  <td>
                    {split.recipients.map((recipient, index) => (
                      <span className="table-secondary" key={recipient}>
                        {shortAddress(recipient)} ·{' '}
                        {formatBasisPoints(split.basisPoints[index] ?? 0)}
                      </span>
                    ))}
                  </td>
                  <td>
                    {formatBasisPoints(split.basisPoints.reduce((sum, value) => sum + value, 0))}
                  </td>
                  <td>
                    <span className={`gp-badge gp-badge--${split.enabled ? 'success' : 'neutral'}`}>
                      {split.enabled ? (ko ? '사용 중' : 'Enabled') : ko ? '비활성' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <div className="inline-actions">
                      {split.splitId !== zeroHash && split.enabled ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={disabling === split.splitId}
                          onClick={() => disable(split.splitId)}
                          aria-label="Disable split"
                        >
                          <Trash2 size={13} />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <Split size={19} />
            </span>
            <h3>{ko ? '온체인 분배가 없습니다' : 'No onchain splits found'}</h3>
          </div>
        )}
      </Card>
    </>
  );
}
