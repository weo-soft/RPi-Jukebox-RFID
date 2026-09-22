import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Grid,
  TextField,
} from '@mui/material';

/*
 * The chip number as a source of its own. The reader does not fill this field:
 * a placed card binds without it, and a typed number carries the same weight.
 * Spaces around a pasted number are dropped, everything else is passed on.
 */
const CardIdField = ({ actionLabel, onActivate }) => {
  const { t } = useTranslation();
  const [cardId, setCardId] = useState('');
  const entered = cardId.trim();

  const activate = () => {
    if (!entered) return;
    setCardId('');
    onActivate(entered);
  };

  return (
    <Grid container spacing={1} sx={{ alignItems: 'center' }}>
      <Grid size={{ md: 8, xs: 12 }}>
        <TextField
          fullWidth
          id="cards-card-id"
          label={t('cards.card-id.label')}
          onChange={(event) => setCardId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') activate();
          }}
          slotProps={{ htmlInput: { sx: { fontFamily: 'monospace' } } }}
          value={cardId}
          variant="outlined"
        />
      </Grid>
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
    </Grid>
  );
};

export default CardIdField;
