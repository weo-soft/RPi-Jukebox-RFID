import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputLabel,
  NativeSelect,
  Typography,
} from '@mui/material';

import { ORDERS } from './orders';

/*
 * The start area of a bulk registration: the source of the albums, the order the physical
 * stack is sorted in, the album the session begins with and the way into the
 * numbered list. It is the first state of the screen; the running session
 * leaves it behind and returns to it through its own control.
 */
const StartPanel = ({
  canStart,
  emptySelection,
  emptySource,
  isSelected,
  memoryNumber,
  missingCount,
  mode,
  onChoose,
  onClearSelection,
  onContinue,
  onOpenList,
  onOrderChange,
  onProviderChange,
  onStart,
  openAlbums,
  orderId,
  provider,
  selectedCount,
  sources,
  startNumber,
  total,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-bulk-source" shrink>
                {t('cards.bulk.source')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-bulk-source' }}
                onChange={(event) => onProviderChange(event.target.value)}
                sx={{ '& select': { height: 'var(--touch-min)' } }}
                value={provider || ''}
              >
                {sources.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-bulk-order" shrink>
                {t('cards.bulk.order')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-bulk-order' }}
                onChange={(event) => onOrderChange(event.target.value)}
                sx={{ '& select': { height: 'var(--touch-min)' } }}
                value={orderId}
              >
                {ORDERS.map(({ id, labelKey }) => (
                  <option key={id} value={id}>{t(labelKey)}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          {mode === 'guided' && !emptySource &&
            <Grid size={{ md: 6, xs: 12 }}>
              <Typography variant="contentBody">{t('cards.bulk.selection')}</Typography>
              <Typography color="textSecondary" variant="contentBody">
                {isSelected
                  ? t('cards.bulk.choice.selected', { count: selectedCount, open: openAlbums })
                  : t('cards.bulk.choice.selected-all')
                }
              </Typography>
              {missingCount > 0 &&
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.bulk.choice.missing', { count: missingCount })}
                </Typography>
              }
              <Grid container sx={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Button onClick={onChoose} variant="outlined">
                  {isSelected ? t('cards.bulk.choice.change') : t('cards.bulk.choice.title')}
                </Button>
                {isSelected &&
                  <Button onClick={onClearSelection} variant="outlined">
                    {t('cards.bulk.choice.clear')}
                  </Button>
                }
              </Grid>
            </Grid>
          }
          <Grid size={12}>
            {emptySource &&
              <>
                <Typography>{t('cards.bulk.empty-source')}</Typography>
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.bulk.empty-source-hint')}
                </Typography>
                <Button
                  component={Link}
                  nativeButton={false}
                  sx={{ marginTop: 'var(--space-2)' }}
                  to="/library"
                  variant="outlined"
                >
                  {t('cards.bulk.to-library')}
                </Button>
              </>
            }
            {!emptySource && emptySelection &&
              <>
                <Typography>{t('cards.bulk.choice.empty')}</Typography>
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.bulk.choice.empty-hint')}
                </Typography>
              </>
            }
            {!emptySource && !emptySelection && canStart &&
              <Typography>
                {t('cards.bulk.start-at', { number: startNumber, total })}
              </Typography>
            }
            {!emptySource && !emptySelection && !canStart &&
              <Typography>{t('cards.bulk.exhausted', { count: total })}</Typography>
            }
          </Grid>
          {memoryNumber > 0 &&
            <Grid
              container
              size={12}
              sx={{ alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Typography>
                {t('cards.bulk.last-at', { number: memoryNumber })}
              </Typography>
              <Button onClick={onContinue} variant="outlined">
                {t('cards.bulk.continue')}
              </Button>
            </Grid>
          }
          <Grid
            container
            size={12}
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          >
            <Button onClick={onOpenList} variant="outlined">
              {t('cards.bulk.open-list')}
            </Button>
            <Button disabled={!canStart} onClick={onStart} variant="contained">
              {mode === 'free' ? t('cards.bulk.start-free') : t('cards.bulk.start')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default StartPanel;
