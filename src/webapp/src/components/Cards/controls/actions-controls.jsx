import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  Button,
  CardActions,
  Typography,
} from '@mui/material';

import CardsDeleteDialog from '../dialogs/delete';
import ConflictPanel from '../series/conflict-panel';
import request from '../../../utils/request';
import { loadRegisteredCards, registeredEntry } from '../registered-cards';
import {
  getActionAndCommand,
  getArgsValues
} from '../utils';

const ActionsControls = ({
  actionData,
  cardId,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { '*': path } = useParams();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [failure, setFailure] = useState(null);

  const isRegistering = path === 'register';

  const submit = async (overwrite) => {
    const args = getArgsValues(actionData);
    const { command: cmd_alias } = getActionAndCommand(actionData);

    const kwargs = {
      card_id: cardId.toString(),
      cmd_alias,
      overwrite,
      ...(args.length && { args }),
    };

    const { error } = await request('registerCard', kwargs);

    if (!error) {
      navigate('../');
      return;
    }

    // A card that appeared in the database in the meantime is a conflict and
    // not a failure of the form.
    const { cards } = await loadRegisteredCards();
    const meanwhile = registeredEntry(cards || {}, cardId);

    if (meanwhile) {
      setConflict(meanwhile);
      return;
    }

    setFailure(error);
  };

  const handleRegisterCard = async () => {
    if (!isRegistering) {
      await submit(true);
      return;
    }

    // The register path checks the card list first; the call without overwrite
    // stays as the safety net behind it.
    const { cards } = await loadRegisteredCards();
    const existing = registeredEntry(cards || {}, cardId);

    if (existing) {
      setConflict(existing);
      return;
    }

    await submit(false);
  };

  const handleRebind = async () => {
    setConflict(null);
    await submit(true);
  };

  const handleDeleteCard = async () => {
    const { error } = await request('deleteCard', { card_id: cardId });

    // TODO: Better Error handling in frontend
    if (error) {
      return console.error(error);
    }

    navigate('/cards');
  };

  return (
    <>
      <CardActions
        sx={{
          flexDirection: { md: 'row', xs: 'column' },
          gap: 'var(--space-2)',
          justifyContent: isRegistering ? 'flex-end' : 'space-between',
          marginTop: '40px',
        }}
      >
        {!isRegistering &&
          <Button
            color="secondary"
            onClick={() => setDeleteDialogOpen(true)}
            sx={{ width: { md: 'auto', xs: '100%' } }}
          >
            {t('general.buttons.delete')}
          </Button>
        }
        <Button
          color="primary"
          onClick={() => handleRegisterCard(cardId)}
          sx={{ width: { md: 'auto', xs: '100%' } }}
        >
          {t('general.buttons.save')}
        </Button>
      </CardActions>
      {conflict &&
        <ConflictPanel
          canRebind
          cardId={cardId}
          existing={conflict}
          onClose={() => setConflict(null)}
          onRebind={handleRebind}
        />
      }
      {failure &&
        <Typography sx={{ marginTop: 'var(--space-2)' }}>
          {t('cards.form.save-failed', { error: failure })}
        </Typography>
      }
      <CardsDeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        doDelete={handleDeleteCard}
        cardId={cardId}
      />
    </>
  );
};

export default ActionsControls;
