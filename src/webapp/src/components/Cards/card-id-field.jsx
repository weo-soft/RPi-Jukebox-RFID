import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Grid,
  TextField,
} from '@mui/material';

/*
 * The chip number as a source of its own. Without an action label the field
 * only carries the number: the form keeps it in its own state and a placement
 * fills it. With an action label the field holds what was typed until the
 * action carries it away - that is the mode of the registration, where a placed card
 * binds without touching the field.
 */
const CardIdField = ({
  actionLabel,
  onActivate,
  onChange,
  value,
}) => {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const isControlled = value !== undefined;
  const cardId = isControlled ? value : typed;
  const entered = (cardId || '').trim();

  const update = (next) => {
    if (isControlled) onChange(next);
    else setTyped(next);
  };

  const activate = () => {
    if (!entered) return;
    if (!isControlled) setTyped('');
    onActivate(entered);
  };

  return (
    <Grid container spacing={1} sx={{ alignItems: 'center' }}>
      <Grid size={actionLabel ? { md: 8, xs: 12 } : 12}>
        <TextField
          fullWidth
          id="cards-card-id"
          label={t('cards.card-id.label')}
          onChange={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (actionLabel && event.key === 'Enter') activate();
          }}
          slotProps={{ htmlInput: { sx: { fontFamily: 'monospace' } } }}
          value={cardId || ''}
          variant="outlined"
        />
      </Grid>
      {actionLabel &&
        <Grid size={{ md: 4, xs: 12 }}>
          <Button
            disabled={!entered}
            fullWidth
            onClick={activate}
            variant="contained"
          >
            {actionLabel}
          </Button>
        </Grid>
      }
    </Grid>
  );
};

export default CardIdField;
